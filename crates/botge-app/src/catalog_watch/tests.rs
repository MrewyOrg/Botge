//! Exercises watch tickets, per-guild change delivery and the 7TV set relay.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]

use std::{assert_matches, sync::Arc, time::Duration};

use anyhow::Result;
use botge_domain::{emotes::GuildEmotes, providers::Providers};
use botge_storage::Store;
use tracing::instrument::WithSubscriber as _;

use super::*;
use crate::access::{AccessToken, Membership, VoiceChannel};

/// `admin` administers every guild, `member` belongs to it, and anyone else is an outsider.
struct Access;

impl GuildAccess for Access {
  fn exchange_code(
    &self,
    _code: &str,
  ) -> impl Future<Output = Result<AccessToken, AccessError>> + Send {
    std::future::ready(Err(AccessError::UNAUTHORIZED))
  }
  fn user_id(
    &self,
    _credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, AccessError>> + Send {
    std::future::ready(Ok(NonZeroU64::MIN))
  }
  fn membership(
    &self,
    _guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Membership, AccessError>> + Send {
    std::future::ready(match credential.token() {
      "admin" | "member" => Ok(Membership {
        administrator: credential.token() == "admin",
        roles: vec![],
        available_roles: vec![],
      }),
      _ => Err(AccessError::NOT_MEMBER),
    })
  }
  fn voice_channels(
    &self,
    _guild: NonZeroU64,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, AccessError>> + Send {
    std::future::ready(Ok(vec![]))
  }
  fn guilds(
    &self,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Vec<crate::access::SharedGuild>, AccessError>> + Send {
    std::future::ready(Ok(vec![]))
  }
}

/// An application over a fresh store, kept alive with its directory, allowing 7TV additions.
fn application() -> Result<(tempfile::TempDir, Arc<Store>, Arc<Application>)> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("watch.redb"))?);
  let policy = Providers {
    seven_added: true,
    ..Providers::default()
  };
  let application = Arc::new(Application::new(policy, Arc::clone(&store))?);
  Ok((directory, store, application))
}

fn guild(id: u64) -> Result<NonZeroU64> {
  NonZeroU64::new(id).ok_or_else(|| anyhow::anyhow!("zero guild"))
}

/// Opens a watch on `guild` for a member.
async fn watcher(application: &Application, guild: NonZeroU64) -> Result<CatalogWatcher> {
  let ticket = application
    .watch_catalog(&Access, guild, &Credential::new("member".into()))
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  application
    .redeem_catalog_watch(&ticket.ticket)
    .ok_or_else(|| anyhow::anyhow!("ticket was not redeemed"))
}

/// Whether a change for this watcher arrives within a short wait.
async fn notified(watcher: &mut CatalogWatcher) -> bool {
  tokio::time::timeout(Duration::from_millis(100), watcher.changed())
    .await
    .is_ok()
}

#[tokio::test]
async fn issues_one_use_tickets_only_to_members() -> Result<()> {
  let (_directory, _store, application) = application()?;
  assert_matches!(
    application
      .watch_catalog(&Access, guild(1)?, &Credential::new("outsider".into()))
      .await,
    Err(AccessError(FailureKind::PermissionDenied, _))
  );
  let ticket = application
    .watch_catalog(&Access, guild(1)?, &Credential::new("member".into()))
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert!(application.redeem_catalog_watch(&ticket.ticket).is_some());
  assert!(application.redeem_catalog_watch(&ticket.ticket).is_none());
  assert!(application.redeem_catalog_watch("unknown").is_none());

  // Too many tickets waiting for a connection are refused until some are used or expire.
  let member = Credential::new("member".into());
  for _ in 0..crate::tickets::MAX_TICKETS {
    application
      .watch_catalog(&Access, guild(1)?, &member)
      .await
      .map_err(|error| anyhow::anyhow!(error.1))?;
  }
  assert_matches!(
    application.watch_catalog(&Access, guild(1)?, &member).await,
    Err(AccessError(FailureKind::Conflict, _))
  );
  Ok(())
}

#[tokio::test(start_paused = true)]
async fn expires_tickets_that_wait_too_long() -> Result<()> {
  let (_directory, _store, application) = application()?;
  let ticket = application
    .watch_catalog(&Access, guild(1)?, &Credential::new("member".into()))
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  tokio::time::advance(crate::tickets::TICKET_LIFETIME).await;
  assert!(application.redeem_catalog_watch(&ticket.ticket).is_none());
  Ok(())
}

#[tokio::test]
async fn announces_saved_changes_only_to_the_guild_that_changed() -> Result<()> {
  let (_directory, store, application) = application()?;
  let mut first = watcher(&application, guild(1)?).await?;
  let mut second = watcher(&application, guild(2)?).await?;
  application
    .save_emote_settings(
      &Access,
      guild(1)?,
      &Credential::new("admin".into()),
      GuildEmotes::default(),
    )
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert!(notified(&mut first).await);
  assert!(!notified(&mut second).await);
  // A rejected save changes nothing, so nobody is told.
  assert_matches!(
    application
      .save_emote_settings(
        &Access,
        guild(1)?,
        &Credential::new("member".into()),
        GuildEmotes::default(),
      )
      .await,
    Err(_)
  );
  assert!(!notified(&mut first).await);
  // Removing a saved addition is announced too.
  let id = "01234567890123456789012345";
  store.add_emote(
    botge_storage::CatalogEditor::system(guild(2)?),
    botge_test_support::example("Wave", id),
  )?;
  application
    .remove_emote(
      &Access,
      guild(2)?,
      &Credential::new("admin".into()),
      id.into(),
    )
    .await
    .map_err(|error| anyhow::anyhow!(error.1))?;
  assert!(notified(&mut second).await);
  assert!(!notified(&mut first).await);
  Ok(())
}

#[tokio::test]
async fn relays_seven_tv_set_edits_to_the_guilds_that_use_them() -> Result<()> {
  let (_directory, store, application) = application()?;
  let set = "01234567890123456789012345";
  store.save_guild_emotes(
    botge_storage::CatalogEditor::system(guild(1)?),
    &GuildEmotes {
      seven_tv_set: Some(set.into()),
      ..GuildEmotes::default()
    },
  )?;
  let mut using = watcher(&application, guild(1)?).await?;
  let mut other = watcher(&application, guild(2)?).await?;
  let (sets, receiver) = broadcast::channel(4);
  let logs = botge_test_support::TestLogs::default();
  let relay = tokio::spawn({
    let application = Arc::clone(&application);
    async move { application.relay_set_changes(receiver).await }.with_subscriber(logs.subscriber())
  });

  sets.send(SetChange {
    id: set.into(),
    global: false,
  })?;
  assert!(notified(&mut using).await);
  assert!(!notified(&mut other).await);
  // The global set is shared, so every guild reloads.
  sets.send(SetChange {
    id: "abcdefabcdefabcdefabcdef".into(),
    global: true,
  })?;
  assert!(notified(&mut using).await);
  assert!(notified(&mut other).await);
  // When the saved policies cannot be read, nobody is told and the relay keeps running.
  store.invalidate_table("guild_emotes")?;
  sets.send(SetChange {
    id: set.into(),
    global: false,
  })?;
  assert!(!notified(&mut using).await);

  drop(sets);
  relay.await?;
  assert!(
    logs
      .text()?
      .contains("Could not find the guilds using a changed 7TV set")
  );
  Ok(())
}
