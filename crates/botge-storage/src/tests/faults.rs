//! Injects backend I/O failures and checks that storage APIs report them.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::{
  io,
  sync::{
    Arc,
    atomic::{AtomicIsize, Ordering},
  },
};

#[cfg(not(test))]
use crate::CatalogEditor;

use redb::{BackendError, StorageBackend, backends::InMemoryBackend};

#[cfg(test)]
use super::super::*;
#[cfg(not(test))]
use super::super::{Database, GuildEmotes, NonZeroU64, Result, Store, VoiceSettings};

#[derive(Debug)]
struct FaultBackend {
  memory: Arc<InMemoryBackend>,
  remaining: Arc<AtomicIsize>,
}

impl FaultBackend {
  #[expect(
    clippy::panic,
    reason = "Exercises isolation of a panicking blocking database task"
  )]
  fn check(&self) -> io::Result<()> {
    let previous = self
      .remaining
      .try_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
        (count > 0).then(|| count - 1)
      });
    if matches!(previous, Err(isize::MIN)) {
      self.remaining.store(-1, Ordering::SeqCst);
      panic!("injected backend panic");
    }
    if matches!(previous, Err(0)) {
      Err(io::Error::other("injected storage I/O failure"))
    } else {
      Ok(())
    }
  }
}

impl StorageBackend for FaultBackend {
  fn len(&self) -> std::result::Result<u64, BackendError> {
    self.check()?;
    self.memory.len()
  }
  fn read(&self, offset: u64, out: &mut [u8]) -> std::result::Result<(), BackendError> {
    self.check()?;
    self.memory.read(offset, out)
  }
  fn set_len(&self, len: u64) -> std::result::Result<(), BackendError> {
    self.check()?;
    self.memory.set_len(len)
  }
  fn sync_data(&self) -> std::result::Result<(), BackendError> {
    self.check()?;
    self.memory.sync_data()
  }
  fn write(&self, offset: u64, data: &[u8]) -> std::result::Result<(), BackendError> {
    self.check()?;
    self.memory.write(offset, data)
  }
}

fn fixture() -> Result<(Store, Arc<AtomicIsize>)> {
  let remaining = Arc::new(AtomicIsize::new(-1));
  let database = Database::builder()
    .set_cache_size(0)
    .create_with_backend(FaultBackend {
      memory: Arc::new(InMemoryBackend::new()),
      remaining: Arc::clone(&remaining),
    })?;
  let store = Store::initialize(database)?;
  store.save_voice_settings(NonZeroU64::MIN, &VoiceSettings::default())?;
  store.save_guild_emotes(
    CatalogEditor::system(NonZeroU64::MIN),
    &GuildEmotes {
      allow_everyone: true,
      ..GuildEmotes::default()
    },
  )?;
  store.save_emote_border(NonZeroU64::MIN, Some(1))?;
  store.add_emote(
    CatalogEditor::system(NonZeroU64::MIN),
    botge_test_support::example("Saved", "saved"),
  )?;
  Ok((store, remaining))
}

impl Store {
  /// Creates an in-memory fixture that panics once on its next backend access.
  pub fn panic_read_fixture() -> Result<Self> {
    let (store, remaining) = fixture()?;
    remaining.store(isize::MIN, Ordering::SeqCst);
    Ok(store)
  }
}

#[test]
fn propagates_read_write_and_commit_failures() -> Result<()> {
  let guild = NonZeroU64::MIN;
  for operation in 0..17 {
    let mut failures = 0;
    for cutoff in 0..32 {
      let (store, remaining) = fixture()?;
      if operation == 16 {
        for index in 0..catalog_history::RETAINED_REVISIONS {
          let name = format!("Retained{index}");
          store.add_emote(
            CatalogEditor::system(guild),
            botge_test_support::example(&name, &name),
          )?;
        }
      }
      remaining.store(cutoff, Ordering::SeqCst);
      let result = match operation {
        0 => store.emote_border(guild).map(|_| ()),
        1 => store.save_emote_border(guild, Some(2)),
        2 => store.save_emote_border(guild, None),
        3 => store.voice_settings(guild).map(|_| ()),
        4 => store.save_voice_settings(guild, &VoiceSettings::default()),
        5 => store.all_voice_settings().map(|_| ()),
        6 => store.guild_emotes(guild).map(|_| ()),
        7 => store.save_guild_emotes(CatalogEditor::system(guild), &GuildEmotes::default()),
        8 => store.added_emotes(guild).map(|_| ()),
        9 => store
          .add_emote(
            CatalogEditor::system(guild),
            botge_test_support::example("Next", "next"),
          )
          .map(|_| ()),
        10 => store
          .remove_emote(CatalogEditor::system(guild), "saved")
          .map(|_| ()),
        11 => store.catalog_history(guild).map(drop),
        12 => store.preview_restore(guild, 0).map(drop),
        13 => store
          .restore_catalog(CatalogEditor::system(guild), 0, 2, RestoreScope::All)
          .map(drop),
        14 => store
          .0
          .begin_read()
          .map_err(Into::into)
          .and_then(|read| catalog_history::verify(&read)),
        15 => store
          .add_emote(
            CatalogEditor::system(NonZeroU64::MAX),
            botge_test_support::example("New guild", "new"),
          )
          .map(drop),
        16 => store
          .remove_emote(CatalogEditor::system(guild), "saved")
          .map(drop),
        _ => anyhow::bail!("unexpected storage operation"),
      };
      if result.is_err() {
        failures += 1;
        // A failed commit can poison the handle; exercise subsequent transaction attempts too.
        let attempts = [
          store.voice_settings(guild).map(|_| ()),
          store.guild_emotes(guild).map(|_| ()),
          store.added_emotes(guild).map(|_| ()),
          store.emote_border(guild).map(|_| ()),
          store.all_voice_settings().map(|_| ()),
          store.catalog_history(guild).map(drop),
          store.preview_restore(guild, 0).map(drop),
          store
            .restore_catalog(CatalogEditor::system(guild), 0, 2, RestoreScope::All)
            .map(drop),
          store.save_voice_settings(guild, &VoiceSettings::default()),
          store.save_guild_emotes(CatalogEditor::system(guild), &GuildEmotes::default()),
          store.save_emote_border(guild, Some(3)),
          store
            .remove_emote(CatalogEditor::system(guild), "saved")
            .map(|_| ()),
        ];
        assert!(attempts.iter().any(Result::is_err));
      }
      remaining.store(-1, Ordering::SeqCst);
      drop(store);
    }
    assert!(
      failures > 0,
      "storage operation {operation} swallowed every injected I/O failure"
    );
  }
  Ok(())
}

#[test]
fn propagates_initialization_failures_without_publishing_a_partial_store() -> Result<()> {
  let mut failures = 0;
  for cutoff in 0..32 {
    let remaining = Arc::new(AtomicIsize::new(-1));
    let database = Database::builder()
      .set_cache_size(0)
      .create_with_backend(FaultBackend {
        memory: Arc::new(InMemoryBackend::new()),
        remaining: Arc::clone(&remaining),
      })?;
    remaining.store(cutoff, Ordering::SeqCst);
    let initialized = Store::initialize(database);
    if initialized.is_err() {
      failures += 1;
    }
    remaining.store(-1, Ordering::SeqCst);
    drop(initialized);
  }
  assert!(failures > 0);
  // Reopening saved data also reads the schema marker through the failing backend.
  let mut reopen_failures = 0;
  for cutoff in 0..32 {
    let (store, remaining) = fixture()?;
    remaining.store(cutoff, Ordering::SeqCst);
    let reopened = Store::initialize(store.0);
    if reopened.is_err() {
      reopen_failures += 1;
    }
    remaining.store(-1, Ordering::SeqCst);
    drop(reopened);
  }
  assert!(reopen_failures > 0);
  Ok(())
}
