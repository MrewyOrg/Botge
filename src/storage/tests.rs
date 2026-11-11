use std::{sync::Barrier, thread};

use super::*;

#[test]
fn refuses_invalid_paths_and_incompatible_database_schemas() -> Result<()> {
  use redb::TableHandle as _;

  let dir = tempfile::tempdir()?;
  assert!(Store::open(dir.path()).is_err());
  let guild = NonZeroU64::MIN;
  for name in [
    VOICE_SETTINGS.name(),
    GUILD_EMOTES.name(),
    ADDED_EMOTES.name(),
    EMOTE_BORDERS.name(),
  ] {
    let path = dir.path().join(format!("{name}.redb"));
    {
      let database = Database::create(&path)?;
      let transaction = database.begin_write()?;
      transaction.open_table(TableDefinition::<u32, u64>::new(name))?;
      transaction.commit()?;
    }
    assert!(Store::open(&path).is_err());
    let store = Store(Database::open(&path)?);
    match name {
      "voice_settings" => {
        assert!(store.voice_settings(guild).is_err());
        assert!(store.all_voice_settings().is_err());
        assert!(
          store
            .save_voice_settings(guild, &VoiceSettings::default())
            .is_err()
        );
      }
      "guild_emotes" => {
        assert!(store.guild_emotes(guild).is_err());
        assert!(
          store
            .save_guild_emotes(guild, &GuildEmotes::default())
            .is_err()
        );
      }
      "added_emotes" => {
        assert!(store.added_emotes(guild).is_err());
        assert!(store.remove_emote(guild, "1").is_err());
      }
      "emote_borders" => {
        assert!(store.emote_border(guild).is_err());
        assert!(store.save_emote_border(guild, Some(1)).is_err());
      }
      _ => anyhow::bail!("unexpected test table {name}"),
    }
  }
  Ok(())
}

#[test]
fn reports_malformed_rows_without_replacing_them() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Store::open(&dir.path().join("botge.redb"))?;
  let guild = NonZeroU64::MIN;
  let transaction = store.0.begin_write()?;
  for table in [VOICE_SETTINGS, GUILD_EMOTES, ADDED_EMOTES] {
    transaction
      .open_table(table)?
      .insert(guild, "invalid JSON")?;
  }
  transaction.commit()?;

  assert!(store.voice_settings(guild).is_err());
  assert!(store.all_voice_settings().is_err());
  assert!(store.guild_emotes(guild).is_err());
  assert!(store.added_emotes(guild).is_err());
  assert!(store.remove_emote(guild, "1").is_err());
  assert!(store.added_emotes(guild).is_err());
  Ok(())
}

#[test]
fn saves_replaces_and_reopens_guild_settings() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let path = dir.path().join("botge.redb");
  let first = NonZeroU64::MIN;
  let second = NonZeroU64::MAX;
  let selected = VoiceSettings {
    channel_id: Some("123".into()),
    status_emoji: Some("<:botge:456>".into()),
    status_enabled: true,
  };
  {
    let store = Store::open(&path)?;
    assert_eq!(store.voice_settings(first)?, VoiceSettings::default());
    store.save_voice_settings(first, &selected)?;
    store.save_voice_settings(second, &VoiceSettings::default())?;
    assert_eq!(
      store.all_voice_settings()?,
      vec![
        (first, selected.clone()),
        (second, VoiceSettings::default())
      ]
    );
  }

  let store = Store::open(&path)?;
  assert_eq!(store.voice_settings(first)?, selected);
  store.save_voice_settings(
    first,
    &VoiceSettings {
      channel_id: None,
      ..selected
    },
  )?;
  assert_eq!(store.voice_settings(first)?.channel(), None);
  assert!(store.voice_settings(first)?.status_enabled);
  Ok(())
}

#[test]
fn rejects_invalid_settings_without_replacing_the_saved_row() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Store::open(&dir.path().join("botge.redb"))?;
  let guild = NonZeroU64::MIN;
  let original = VoiceSettings::default();
  store.save_voice_settings(guild, &original)?;
  assert!(
    store
      .save_voice_settings(
        guild,
        &VoiceSettings {
          channel_id: Some("0".into()),
          ..VoiceSettings::default()
        }
      )
      .is_err()
  );
  assert_eq!(store.voice_settings(guild)?, original);
  Ok(())
}

#[test]
fn persists_emote_settings_and_added_emotes_with_atomic_duplicate_checks() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Store::open(&dir.path().join("botge.redb"))?;
  let guild = NonZeroU64::MIN;
  let other = NonZeroU64::MAX;
  assert_eq!(store.guild_emotes(guild)?, GuildEmotes::default());
  let mut settings = GuildEmotes {
    allow_everyone: true,
    ..GuildEmotes::default()
  };
  store.save_guild_emotes(guild, &settings)?;
  assert_eq!(store.guild_emotes(guild)?, settings);
  settings.seven_tv_set = Some("invalid".into());
  assert!(store.save_guild_emotes(guild, &settings).is_err());
  let first = crate::emotes::tests::example("Wave", "1");
  assert!(store.add_emote(guild, first.clone())?);
  assert!(!store.add_emote(guild, crate::emotes::tests::example("wave", "2"))?);
  assert!(!store.add_emote(guild, crate::emotes::tests::example("Other", "1"))?);
  assert!(store.added_emotes(other)?.is_empty());
  assert_eq!(store.added_emotes(guild)?, vec![first]);
  assert!(store.remove_emote(guild, "1")?);
  assert!(!store.remove_emote(guild, "1")?);
  assert!(store.added_emotes(guild)?.is_empty());
  Ok(())
}

#[test]
fn concurrent_adds_keep_distinct_emotes_and_reject_duplicate_names() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Store::open(&dir.path().join("botge.redb"))?;
  let guild = NonZeroU64::MIN;
  // Release all three writers together to exercise duplicate detection under contention.
  let start = Barrier::new(3);

  thread::scope(|scope| -> Result<()> {
    let add = |name, id| {
      let start = &start;
      let store = &store;
      scope.spawn(move || {
        start.wait();
        store.add_emote(guild, crate::emotes::tests::example(name, id))
      })
    };
    let first = add("Wave", "1");
    let duplicate = add("wave", "2");
    let distinct = add("Other", "3");
    let first = first
      .join()
      .map_err(|_| anyhow::anyhow!("writer panicked"))??;
    let duplicate = duplicate
      .join()
      .map_err(|_| anyhow::anyhow!("writer panicked"))??;
    assert_ne!(first, duplicate);
    assert!(
      distinct
        .join()
        .map_err(|_| anyhow::anyhow!("writer panicked"))??
    );

    let mut ids: Vec<_> = store
      .added_emotes(guild)?
      .into_iter()
      .map(|emote| emote.id)
      .collect();
    ids.sort_unstable();
    assert_eq!(ids, [if first { "1" } else { "2" }, "3"]);
    Ok(())
  })
}
