//! Injects backend I/O failures and checks that storage APIs report them.

use std::{
  io,
  sync::{
    Arc,
    atomic::{AtomicIsize, Ordering},
  },
};

use anyhow::Result;
use redb::{StorageBackend, backends::InMemoryBackend};

use super::super::*;

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
  fn len(&self) -> io::Result<u64> {
    self.check()?;
    self.memory.len()
  }
  fn read(&self, offset: u64, output: &mut [u8]) -> io::Result<()> {
    self.check()?;
    self.memory.read(offset, output)
  }
  fn set_len(&self, length: u64) -> io::Result<()> {
    self.check()?;
    self.memory.set_len(length)
  }
  fn sync_data(&self) -> io::Result<()> {
    self.check()?;
    self.memory.sync_data()
  }
  fn write(&self, offset: u64, bytes: &[u8]) -> io::Result<()> {
    self.check()?;
    self.memory.write(offset, bytes)
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
  store.save_guild_emotes(NonZeroU64::MIN, &GuildEmotes::default())?;
  store.save_emote_border(NonZeroU64::MIN, Some(1))?;
  store.add_emote(
    NonZeroU64::MIN,
    crate::emotes::tests::example("Saved", "saved"),
  )?;
  Ok((store, remaining))
}

impl Store {
  /// Creates an in-memory fixture that panics once on its next backend access.
  pub(crate) fn panic_read_fixture() -> Result<Self> {
    let (store, remaining) = fixture()?;
    remaining.store(isize::MIN, Ordering::SeqCst);
    Ok(store)
  }
}

#[test]
fn propagates_read_write_and_commit_failures() -> Result<()> {
  let guild = NonZeroU64::MIN;
  for operation in 0..11 {
    let mut failures = 0;
    for cutoff in 0..8 {
      let (store, remaining) = fixture()?;
      remaining.store(cutoff, Ordering::SeqCst);
      let result = match operation {
        0 => store.emote_border(guild).map(|_| ()),
        1 => store.save_emote_border(guild, Some(2)),
        2 => store.save_emote_border(guild, None),
        3 => store.voice_settings(guild).map(|_| ()),
        4 => store.save_voice_settings(guild, &VoiceSettings::default()),
        5 => store.all_voice_settings().map(|_| ()),
        6 => store.guild_emotes(guild).map(|_| ()),
        7 => store.save_guild_emotes(guild, &GuildEmotes::default()),
        8 => store.added_emotes(guild).map(|_| ()),
        9 => store
          .add_emote(guild, crate::emotes::tests::example("Next", "next"))
          .map(|_| ()),
        10 => store.remove_emote(guild, "saved").map(|_| ()),
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
          store.save_voice_settings(guild, &VoiceSettings::default()),
          store.save_guild_emotes(guild, &GuildEmotes::default()),
          store.save_emote_border(guild, Some(3)),
          store.remove_emote(guild, "saved").map(|_| ()),
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
