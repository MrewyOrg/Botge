//! Tests atomic catalog conflict handling inside the application boundary.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use anyhow::Result;
use botge_domain::providers::Providers;
use botge_emotes::catalog::Catalog;
use botge_storage::Store;
use botge_test_support::example;

use super::*;

struct Access;

impl GuildAccess for Access {
  fn exchange_code(
    &self,
    _code: &str,
  ) -> impl Future<Output = Result<super::super::access::AccessToken, ApiError>> + Send {
    std::future::ready(Err(ApiError::UNAUTHORIZED))
  }
  fn user_id(
    &self,
    credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, ApiError>> + Send {
    std::future::ready(if credential.token() == "admin" {
      Ok(NonZeroU64::MIN)
    } else {
      Err(ApiError::UNAUTHORIZED)
    })
  }
  fn membership(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Membership, ApiError>> + Send {
    std::future::ready(Ok(Membership {
      administrator: matches!(credential.token(), "admin" | "identity-unavailable"),
      roles: vec![],
      available_roles: vec![],
    }))
  }
  fn voice_channels(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Vec<super::super::access::VoiceChannel>, ApiError>> + Send {
    std::future::ready(if credential.token() == "admin" {
      Ok(vec![super::super::access::VoiceChannel {
        id: "42".into(),
        name: "Fixture".into(),
      }])
    } else {
      Err(ApiError::FORBIDDEN)
    })
  }
  fn guilds(
    &self,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Vec<super::super::access::SharedGuild>, ApiError>> + Send {
    std::future::ready(Err(ApiError::UNAUTHORIZED))
  }
}

#[tokio::test]
async fn catalog_history_rechecks_identity_and_refuses_outdated_restores() -> Result<()> {
  use std::assert_matches;

  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("restore.redb"))?);
  let app = Application::new(Providers::default(), Arc::clone(&store))?;
  let guild = NonZeroU64::MIN;
  let editor = CatalogEditor::system(guild);
  let administrator = Credential::new("admin".into());
  let member = Credential::new("member".into());
  let unidentified = Credential::new("identity-unavailable".into());
  assert_matches!(
    app.catalog_history(&Access, guild, &member).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_matches!(
    app
      .preview_catalog_restore(&Access, guild, &member, 0)
      .await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_matches!(
    app.restore_catalog(&Access, guild, &member, 0, 0).await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_matches!(
    app
      .restore_catalog(&Access, guild, &unidentified, 0, 0)
      .await,
    Err(ApiError(FailureKind::Unauthenticated, _))
  );
  assert_matches!(
    app
      .preview_catalog_restore(&Access, guild, &administrator, 0)
      .await,
    Err(ApiError(FailureKind::NotFound, _))
  );
  assert_matches!(
    app
      .restore_catalog(&Access, guild, &administrator, 0, 0)
      .await,
    Err(ApiError(FailureKind::NotFound, _))
  );

  let emote = example("Wave", "1");
  store.add_emote(editor, emote.clone())?;
  let history = app.catalog_history(&Access, guild, &administrator).await?;
  assert_eq!(history.current_revision, 1);
  let preview = app
    .preview_catalog_restore(&Access, guild, &administrator, 0)
    .await?;
  assert_eq!(preview.removed, ["Wave"]);
  assert_matches!(
    app
      .restore_catalog(&Access, guild, &administrator, 0, 1)
      .await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(
    app
      .restore_catalog(&Access, guild, &administrator, 1, 1)
      .await?,
    1
  );

  let enabled = Application::new(
    Providers {
      seven_added: true,
      ..Default::default()
    },
    Arc::clone(&store),
  )?;
  store.save_untracked_policy_fixture(
    guild,
    &GuildEmotes {
      allow_everyone: true,
      ..Default::default()
    },
  )?;
  assert_matches!(
    enabled
      .restore_catalog(&Access, guild, &administrator, 0, 1)
      .await,
    Err(ApiError(
      FailureKind::Conflict,
      "The catalog changed outside its history. Save a catalog edit before restoring."
    ))
  );
  assert_eq!(store.added_emotes(guild)?, [emote]);
  store.save_guild_emotes(editor, &GuildEmotes::default())?;
  assert_matches!(
    enabled
      .restore_catalog(&Access, guild, &administrator, 0, 1)
      .await,
    Err(ApiError(FailureKind::Conflict, _))
  );
  assert_eq!(
    enabled
      .restore_catalog(&Access, guild, &administrator, 0, 2)
      .await?,
    3
  );
  assert_eq!(store.added_emotes(guild)?, []);
  Ok(())
}

#[tokio::test]
async fn catalog_history_reports_worker_failures_as_service_errors() -> Result<()> {
  use std::assert_matches;

  let guild = NonZeroU64::MIN;
  let admin = Credential::new("admin".into());
  let fixture = || Application::new(Providers::default(), Arc::new(Store::panic_read_fixture()?));
  assert_matches!(
    fixture()?.catalog_history(&Access, guild, &admin).await,
    Err(ApiError(FailureKind::Internal, _))
  );
  assert_matches!(
    fixture()?
      .preview_catalog_restore(&Access, guild, &admin, 0)
      .await,
    Err(ApiError(FailureKind::Internal, _))
  );
  assert_matches!(
    fixture()?
      .restore_catalog(&Access, guild, &admin, 0, 1)
      .await,
    Err(ApiError(FailureKind::Internal, _))
  );
  Ok(())
}

#[tokio::test]
async fn rejects_id_conflicts_and_concurrent_additions_after_a_stale_catalog_read() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("catalog.redb"))?);
  let application = Application::new(Providers::default(), Arc::clone(&store))?;
  let emote = example("Wave", "01234567890123456789012345");
  assert_eq!(
    store.add_emote(CatalogEditor::system(NonZeroU64::MIN), emote.clone())?,
    AddEmoteOutcome::Added
  );
  let error = application
    .add_to_catalog(
      CatalogEditor::system(NonZeroU64::MIN),
      emote.clone(),
      &Catalog::new(vec![], vec![]),
    )
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("stale insertion was accepted"))?;
  assert_eq!(error.0, FailureKind::Conflict);
  let mut renamed = emote.clone();
  renamed.name = "Renamed".into();
  let error = application
    .add_to_catalog(
      CatalogEditor::system(NonZeroU64::MIN),
      renamed,
      &Catalog::new(vec![emote], vec![]),
    )
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("duplicate ID was accepted"))?;
  assert_eq!(error.0, FailureKind::Conflict);
  assert_eq!(store.added_emotes(NonZeroU64::MIN)?.len(), 1);
  Ok(())
}

#[tokio::test]
async fn explains_why_an_addition_conflicts() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("reasons.redb"))?);
  let application = Application::new(Providers::default(), Arc::clone(&store))?;
  let guild = NonZeroU64::MIN;
  let saved = example("Wave", "01234567890123456789012345");
  assert_eq!(
    store.add_emote(CatalogEditor::system(guild), saved.clone())?,
    AddEmoteOutcome::Added
  );
  let stale = Catalog::new(vec![], vec![]);
  let fresh = Catalog::new(vec![saved.clone()], vec![]);
  let mut same_name = example("wave", "11234567890123456789012345");
  same_name.name = "WAVE".into();
  // The snapshot catches provider and saved entries; storage catches same-batch additions.
  for (emote, catalog, expected) in [
    (saved.clone(), &fresh, ALREADY_ADDED.1),
    (same_name.clone(), &fresh, NAME_TAKEN.1),
    (saved, &stale, ALREADY_ADDED.1),
    (same_name, &stale, NAME_TAKEN.1),
  ] {
    let error = application
      .add_to_catalog(CatalogEditor::system(guild), emote, catalog)
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("conflict was accepted"))?;
    assert_eq!(error.1, expected);
  }
  let full = NonZeroU64::MAX;
  let entries: Vec<_> = (0..1000)
    .map(|index| example(&format!("Fill{index}"), &index.to_string()))
    .collect();
  store.save_untracked_emotes_fixture(full, &entries)?;
  let error = application
    .add_to_catalog(
      CatalogEditor::system(full),
      example("Extra", "21234567890123456789012345"),
      &stale,
    )
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("full catalog accepted an addition"))?;
  assert_eq!(error.1, CATALOG_FULL.1);
  Ok(())
}

#[tokio::test]
async fn denies_writes_and_wakes_voice_only_after_a_valid_commit() -> Result<()> {
  use std::assert_matches;
  use std::time::Duration;
  use tokio::sync::Notify;

  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("authorization.redb"))?);
  let application = Application::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    Arc::clone(&store),
  )?;
  let guild = NonZeroU64::MIN;
  let member = Credential::new("member".into());
  let admin = Credential::new("admin".into());
  let changed = Notify::new();
  let saved = VoiceSettings {
    channel_id: Some("42".into()),
    status_enabled: true,
    status_emoji: Some("fixture".into()),
  };

  assert_matches!(
    application
      .save_voice_settings(&Access, guild, &member, saved.clone(), &changed)
      .await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_matches!(
    application
      .save_emote_settings(&Access, guild, &member, GuildEmotes::default())
      .await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_matches!(
    application.save_border(&Access, &member, Some(1)).await,
    Err(ApiError(FailureKind::Unauthenticated, _))
  );
  assert_matches!(
    application
      .remove_emote(&Access, guild, &member, "01234567890123456789012345".into())
      .await,
    Err(ApiError(FailureKind::PermissionDenied, _))
  );
  assert_eq!(store.voice_settings(guild)?, VoiceSettings::default());
  assert_eq!(store.guild_emotes(guild)?, GuildEmotes::default());
  assert_eq!(store.emote_border(guild)?, None);
  assert_matches!(
    tokio::time::timeout(Duration::ZERO, changed.notified()).await,
    Err(_)
  );

  let unavailable = VoiceSettings {
    channel_id: Some("43".into()),
    ..saved.clone()
  };
  assert_matches!(
    application
      .save_voice_settings(&Access, guild, &admin, unavailable, &changed)
      .await,
    Err(ApiError(FailureKind::InvalidInput, _))
  );
  let (committed, _) = application
    .save_voice_settings(&Access, guild, &admin, saved.clone(), &changed)
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert_eq!(committed, saved);
  assert_eq!(store.voice_settings(guild)?, saved);
  tokio::time::timeout(Duration::from_secs(1), changed.notified()).await?;

  store.invalidate_table("voice_settings")?;
  assert_matches!(
    application
      .save_voice_settings(&Access, guild, &admin, committed, &changed)
      .await,
    Err(ApiError(FailureKind::Internal, _))
  );
  assert_matches!(
    tokio::time::timeout(Duration::ZERO, changed.notified()).await,
    Err(_)
  );
  assert_matches!(
    application
      .save_border(&Access, &admin, Some(0x0100_0000))
      .await,
    Err(ApiError(FailureKind::InvalidInput, _))
  );
  Ok(())
}

#[tokio::test]
async fn distinguishes_provider_identity_and_rechecks_member_capabilities() -> Result<()> {
  use std::assert_matches;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("identity.redb"))?);
  let application = Application::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    Arc::clone(&store),
  )?;
  let guild = NonZeroU64::MIN;
  let member = Credential::new("member".into());
  let view = application
    .guild_catalog(&Access, guild, &member)
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert!(!view.can_manage);
  assert!(view.can_compose_discovery);

  let proposed = example("New", "shared-provider-id");
  let other = example("Existing", "different-id");
  application
    .add_to_catalog(
      CatalogEditor::system(guild),
      proposed,
      &Catalog::new(vec![other], vec![]),
    )
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert_eq!(store.added_emotes(guild)?.len(), 1);
  application
    .remove_from_catalog(CatalogEditor::system(guild), "shared-provider-id".into())
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert_matches!(
    application
      .remove_from_catalog(CatalogEditor::system(guild), "shared-provider-id".into())
      .await,
    Err(ApiError(FailureKind::NotFound, _))
  );
  Ok(())
}

#[tokio::test]
async fn rejects_invalid_mutations_before_any_provider_or_storage_write() -> Result<()> {
  use std::assert_matches;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("input.redb"))?);
  let application = Application::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    Arc::clone(&store),
  )?;
  let guild = NonZeroU64::MIN;
  let admin = Credential::new("admin".into());
  for id in ["", "bad", "0123456789012345678901234/"] {
    assert_matches!(
      application.add_emote(&Access, guild, &admin, id).await,
      Err(ApiError(FailureKind::InvalidInput, _))
    );
    assert_matches!(
      application
        .remove_emote(&Access, guild, &admin, id.into())
        .await,
      Err(ApiError(FailureKind::InvalidInput, _))
    );
  }
  let id = "01234567890123456789012345".to_owned();
  for ids in [
    vec![],
    vec![id.clone(); 13],
    vec!["bad".into()],
    vec![id.clone(), id],
  ] {
    assert_matches!(
      application
        .change_emotes(&Access, guild, &admin, EmoteAction::Remove, ids)
        .await,
      Err(ApiError(FailureKind::InvalidInput, _))
    );
  }
  let invalid = GuildEmotes {
    seven_tv_set: Some("not/a/set".into()),
    ..GuildEmotes::default()
  };
  assert_matches!(
    application
      .save_emote_settings(&Access, guild, &admin, invalid)
      .await,
    Err(ApiError(FailureKind::InvalidInput, _))
  );
  let invalid = VoiceSettings {
    status_emoji: Some("status\0".into()),
    ..VoiceSettings::default()
  };
  assert_matches!(
    application
      .save_voice_settings(&Access, guild, &admin, invalid, &tokio::sync::Notify::new())
      .await,
    Err(ApiError(FailureKind::InvalidInput, _))
  );
  assert_eq!(store.guild_emotes(guild)?, GuildEmotes::default());
  assert_eq!(store.added_emotes(guild)?, []);
  Ok(())
}

#[tokio::test]
async fn disabled_additions_never_offer_management_even_to_administrators() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("disabled.redb"))?);
  let application = Application::new(Providers::default(), store)?;
  let catalog = application
    .guild_catalog(&Access, NonZeroU64::MIN, &Credential::new("admin".into()))
    .await
    .map_err(|error| anyhow::anyhow!("{error:?}"))?;
  assert!(!catalog.can_manage);
  assert!(!catalog.can_compose_discovery);
  Ok(())
}
