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
    std::future::ready(match credential {
      Credential::Code(code) if code == "admin" => Ok(NonZeroU64::MIN),
      _ => Err(ApiError::UNAUTHORIZED),
    })
  }
  fn membership(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<super::super::access::Membership, ApiError>> + Send {
    std::future::ready(Ok(super::super::access::Membership {
      administrator: matches!(credential,Credential::Code(code) if code=="admin"),
      roles: vec![],
      available_roles: vec![],
    }))
  }
  fn voice_channels(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Vec<super::super::access::VoiceChannel>, ApiError>> + Send {
    std::future::ready(
      if matches!(credential,Credential::Code(code) if code=="admin") {
        Ok(vec![super::super::access::VoiceChannel {
          id: "42".into(),
          name: "Fixture".into(),
        }])
      } else {
        Err(ApiError::FORBIDDEN)
      },
    )
  }
}

#[tokio::test]
async fn rejects_id_conflicts_and_concurrent_additions_after_a_stale_catalog_read() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("catalog.redb"))?);
  let application = Application::new(Providers::default(), Arc::clone(&store), None)?;
  let emote = example("Wave", "01234567890123456789012345");
  assert!(store.add_emote(NonZeroU64::MIN, emote.clone())?);
  let error = application
    .add_to_catalog(
      NonZeroU64::MIN,
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
    .add_to_catalog(NonZeroU64::MIN, renamed, &Catalog::new(vec![emote], vec![]))
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
  let application = Application::new(Providers::default(), Arc::clone(&store), None)?;
  let guild = NonZeroU64::MIN;
  let saved = example("Wave", "01234567890123456789012345");
  assert!(store.add_emote(guild, saved.clone())?);
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
      .add_to_catalog(guild, emote, catalog)
      .await
      .err()
      .ok_or_else(|| anyhow::anyhow!("conflict was accepted"))?;
    assert_eq!(error.1, expected);
  }
  let full = NonZeroU64::MAX;
  for index in 0..1000 {
    assert!(store.add_emote(full, example(&format!("Fill{index}"), &index.to_string()))?);
  }
  let error = application
    .add_to_catalog(full, example("Extra", "21234567890123456789012345"), &stale)
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
    None,
  )?;
  let guild = NonZeroU64::MIN;
  let member = Credential::Code("member".into());
  let admin = Credential::Code("admin".into());
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
    None,
  )?;
  let guild = NonZeroU64::MIN;
  let member = Credential::Code("member".into());
  let view = application
    .guild_catalog(&Access, guild, &member)
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert!(!view.can_manage);
  assert!(view.can_compose_discovery);

  let proposed = example("New", "shared-provider-id");
  let mut other = example("Existing", "shared-provider-id");
  other.source = botge_domain::emotes::Source::BetterTtv;
  application
    .add_to_catalog(guild, proposed, &Catalog::new(vec![other], vec![]))
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert_eq!(store.added_emotes(guild)?.len(), 1);
  application
    .remove_from_catalog(guild, "shared-provider-id".into())
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert_matches!(
    application
      .remove_from_catalog(guild, "shared-provider-id".into())
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
    None,
  )?;
  let guild = NonZeroU64::MIN;
  let admin = Credential::Code("admin".into());
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
    ffz_channel: Some("not/a/channel".into()),
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
  let application = Application::new(Providers::default(), store, None)?;
  let catalog = application
    .guild_catalog(&Access, NonZeroU64::MIN, &Credential::Code("admin".into()))
    .await
    .map_err(|error| anyhow::anyhow!("{error:?}"))?;
  assert!(!catalog.can_manage);
  assert!(!catalog.can_compose_discovery);
  Ok(())
}
