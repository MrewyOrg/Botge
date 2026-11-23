//! Exercises revision retention, authorization scope, and transaction ordering offline.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use std::{assert_matches, sync::Barrier, thread};

use botge_domain::emotes::{Emote, GuildEmotes};
use botge_test_support::example;

use super::*;
use crate::AddEmoteOutcome;

const EDITOR: CatalogEditor = CatalogEditor {
  guild: NonZeroU64::MIN,
  actor: Some(NonZeroU64::MAX),
};

#[test]
fn reopens_and_restores_settings_and_additions_in_one_revision() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let path = directory.path().join("history.redb");
  let store = Store::open(&path)?;
  let original = GuildEmotes {
    allow_everyone: true,
    ..GuildEmotes::default()
  };
  assert_eq!(store.catalog_history(EDITOR.guild)?.revisions, []);
  store.save_guild_emotes(EDITOR, &original)?;
  assert_eq!(
    store.add_emote(EDITOR, example("Wave", "1"))?,
    AddEmoteOutcome::Added
  );
  store.save_guild_emotes(EDITOR, &GuildEmotes::default())?;
  assert!(store.remove_emote(EDITOR, "1")?);
  drop(store);

  crate::verify_backup(&path)?;
  let store = Store::open(&path)?;
  let preview = store
    .preview_restore(EDITOR.guild, 2)?
    .context("missing preview")?;
  assert_eq!((preview.current_revision, preview.target_revision), (4, 2));
  assert_eq!(preview.added, ["Wave"]);
  assert_eq!(preview.restored_settings, original);
  assert_eq!(preview.current_settings, GuildEmotes::default());
  assert_eq!(
    store.restore_catalog(EDITOR, 2, 4, RestoreScope::SettingsOnly)?,
    RestoreOutcome::AdditionsDisabled
  );
  assert_eq!(
    store.restore_catalog(EDITOR, 2, 4, RestoreScope::All)?,
    RestoreOutcome::Restored(5)
  );
  assert_eq!(
    store.added_emotes(EDITOR.guild)?,
    vec![example("Wave", "1")]
  );
  assert_eq!(store.guild_emotes(EDITOR.guild)?, original);
  let history = store.catalog_history(EDITOR.guild)?;
  assert_eq!(history.current_revision, 5);
  let entry = history.revisions.first().context("missing revision")?;
  assert_eq!(entry.edit, CatalogEdit::Restored { revision: 2 });
  assert_eq!(entry.actor_id, Some(NonZeroU64::MAX.to_string()));
  assert_eq!(
    store.restore_catalog(EDITOR, 2, 5, RestoreScope::All)?,
    RestoreOutcome::Unchanged
  );
  assert_eq!(
    store.restore_catalog(EDITOR, 4, 5, RestoreScope::All)?,
    RestoreOutcome::Restored(6)
  );
  assert_eq!(store.added_emotes(EDITOR.guild)?, []);
  Ok(())
}

#[test]
fn isolates_and_expires_revisions_without_changing_saved_catalogs() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Store::open(&directory.path().join("revisions.redb"))?;
  let other = CatalogEditor::system(NonZeroU64::MAX);
  store.add_emote(other, example("Other", "1"))?;
  for id in 1..=RETAINED_REVISIONS + 1 {
    store.save_guild_emotes(
      EDITOR,
      &GuildEmotes {
        allowed_roles: vec![id.to_string()],
        ..GuildEmotes::default()
      },
    )?;
  }
  let history = store.catalog_history(EDITOR.guild)?;
  assert_eq!(history.current_revision, RETAINED_REVISIONS + 1);
  assert_eq!(u64::try_from(history.revisions.len())?, RETAINED_REVISIONS);
  assert_eq!(
    history.revisions.last().map(|entry| entry.revision),
    Some(2)
  );
  assert!(store.preview_restore(EDITOR.guild, 1)?.is_none());
  assert_eq!(
    store.restore_catalog(EDITOR, 1, history.current_revision, RestoreScope::All)?,
    RestoreOutcome::Missing
  );
  assert_eq!(
    store.restore_catalog(other, 1, 0, RestoreScope::All)?,
    RestoreOutcome::Stale
  );
  assert_eq!(
    store.added_emotes(other.guild)?,
    vec![example("Other", "1")]
  );
  let empty = CatalogEditor::system(NonZeroU64::new(2).context("invalid fixture guild")?);
  assert_eq!(
    store.restore_catalog(empty, 0, 0, RestoreScope::All)?,
    RestoreOutcome::Missing
  );
  Ok(())
}

#[test]
fn commits_only_one_concurrent_restore_and_skips_denied_edits() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Store::open(&directory.path().join("concurrent.redb"))?;
  assert!(!store.remove_emote(EDITOR, "absent")?);
  assert_eq!(store.catalog_history(EDITOR.guild)?.revisions, []);

  let first = example("First", "1");
  store.add_emote(EDITOR, first.clone())?;
  store.add_emote(EDITOR, example("Second", "2"))?;
  assert_eq!(
    store.add_emote(EDITOR, first)?,
    AddEmoteOutcome::DuplicateId
  );
  let revisions = store.catalog_history(EDITOR.guild)?;
  assert_eq!(revisions.current_revision, 2);
  assert_eq!(revisions.revisions.len(), 3);

  let start = Barrier::new(2);
  let (first, second) = thread::scope(|scope| -> Result<_> {
    let run = |revision| {
      let start = &start;
      let store = &store;
      scope.spawn(move || {
        start.wait();
        store.restore_catalog(EDITOR, revision, 2, RestoreScope::All)
      })
    };
    let left = run(0);
    let right = run(1);
    Ok((
      left
        .join()
        .map_err(|_panic| anyhow::anyhow!("first restore panicked"))??,
      right
        .join()
        .map_err(|_panic| anyhow::anyhow!("second restore panicked"))??,
    ))
  })?;
  assert_matches!(
    (first, second),
    (RestoreOutcome::Restored(3), RestoreOutcome::Stale)
      | (RestoreOutcome::Stale, RestoreOutcome::Restored(3))
  );
  assert_eq!(store.catalog_history(EDITOR.guild)?.current_revision, 3);
  Ok(())
}

#[test]
fn first_edit_preserves_an_older_catalog_without_history_tables() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let path = directory.path().join("legacy.redb");
  {
    let store = Store::open(&path)?;
    let transaction = store.0.begin_write()?;
    assert!(transaction.delete_table(REVISIONS)?);
    assert!(transaction.delete_table(SNAPSHOTS)?);
    // Earlier releases could store additional feed fields. A save retains the 7TV values.
    transaction.open_table(GUILD_EMOTES)?.insert(
      EDITOR.guild,
      r#"{"allowEveryone":true,"unusedFeed":"value"}"#,
    )?;
    transaction.commit()?
  };
  crate::verify_backup(&path)?;
  let store = Store::open(&path)?;
  let original = store.guild_emotes(EDITOR.guild)?;
  assert!(original.allow_everyone);
  assert_eq!(store.catalog_history(EDITOR.guild)?.revisions, []);
  store.save_guild_emotes(EDITOR, &GuildEmotes::default())?;
  let preview = store
    .preview_restore(EDITOR.guild, 0)?
    .context("missing baseline")?;
  assert_eq!(preview.restored_settings, original);
  assert_eq!(
    store.restore_catalog(EDITOR, 0, 1, RestoreScope::SettingsOnly)?,
    RestoreOutcome::Restored(2)
  );
  assert_eq!(store.guild_emotes(EDITOR.guild)?, original);
  Ok(())
}

#[test]
fn preview_distinguishes_updated_entries_and_order_from_adds_and_removes() {
  let first = example("First", "1");
  let second = example("Second", "2");
  let current = CatalogSnapshot {
    additions: vec![first.clone(), second.clone(), example("Removed", "3")],
    ..CatalogSnapshot::default()
  };
  let target = CatalogSnapshot {
    additions: vec![
      second,
      Emote {
        name: "Renamed".into(),
        ..first
      },
      example("Added", "4"),
    ],
    ..CatalogSnapshot::default()
  };
  let preview = CatalogPreview::compare(5, 2, &current, &target);
  assert_eq!(preview.added, ["Added"]);
  assert_eq!(preview.removed, ["Removed"]);
  assert_eq!(preview.updated, ["Renamed"]);
  assert!(preview.order_changed);
}

#[test]
fn protects_edits_from_an_older_binary_after_a_downgrade() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Store::open(&directory.path().join("downgraded.redb"))?;
  store.add_emote(EDITOR, example("Added", "1"))?;
  // An older binary can update the live policy without appending a revision.
  store.save_json(
    GUILD_EMOTES,
    EDITOR.guild,
    &GuildEmotes {
      allow_everyone: true,
      ..GuildEmotes::default()
    },
  )?;
  assert_eq!(
    store.restore_catalog(EDITOR, 0, 1, RestoreScope::All)?,
    RestoreOutcome::Untracked
  );
  assert!(store.guild_emotes(EDITOR.guild)?.allow_everyone);
  assert_eq!(store.catalog_history(EDITOR.guild)?.current_revision, 1);

  store.add_emote(EDITOR, example("Next", "2"))?;
  assert_eq!(
    store.restore_catalog(EDITOR, 0, 2, RestoreScope::All)?,
    RestoreOutcome::Restored(3)
  );
  Ok(())
}

#[test]
fn rejects_backups_with_missing_or_mismatched_history_records() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let guild = EDITOR.guild;
  for fault in [
    "missing",
    "wrong-key",
    "wrong-revision",
    "unreadable",
    "unreadable-metadata",
    "missing-table",
  ] {
    let path = directory.path().join(format!("history-{fault}.redb"));
    {
      let store = Store::open(&path)?;
      store.add_emote(EDITOR, example("Wave", "1"))?;
      let write = store.0.begin_write()?;
      match fault {
        "missing" => {
          write.open_table(SNAPSHOTS)?.remove((guild, 0))?;
        }
        "wrong-key" => {
          let mut table = write.open_table(SNAPSHOTS)?;
          let saved = table
            .remove((guild, 0))?
            .context("missing fixture snapshot")?
            .value()
            .to_owned();
          table.insert((guild, 3), saved.as_str())?;
        }
        "wrong-revision" => {
          let different =
            serde_json::to_string(&CatalogRevision::new(3, 0, None, CatalogEdit::Baseline))?;
          write
            .open_table(REVISIONS)?
            .insert((guild, 0), different.as_str())?;
        }
        "unreadable" => {
          write
            .open_table(SNAPSHOTS)?
            .insert((guild, 0), "not a snapshot")?;
        }
        "unreadable-metadata" => {
          write
            .open_table(REVISIONS)?
            .insert((guild, 0), "not metadata")?;
        }
        "missing-table" => {
          assert!(write.delete_table(REVISIONS)?);
        }
        _ => anyhow::bail!("unknown history fault"),
      }
      write.commit()?
    };
    let error = crate::verify_backup(&path)
      .err()
      .context("incomplete history was accepted")?;
    assert_eq!(error.to_string(), "could not verify catalog history");
  }
  Ok(())
}

#[test]
fn preserves_live_catalog_after_a_failed_history_write() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Store::open(&directory.path().join("revision-limit.redb"))?;
  let guild = EDITOR.guild;
  let original = example("Wave", "1");
  store.add_emote(EDITOR, original.clone())?;
  let transaction = store.0.begin_write()?;
  let metadata = serde_json::to_string(&CatalogRevision::new(
    u64::MAX,
    0,
    None,
    CatalogEdit::Baseline,
  ))?;
  transaction
    .open_table(REVISIONS)?
    .insert((guild, u64::MAX), metadata.as_str())?;
  transaction.commit()?;

  let error = store
    .remove_emote(EDITOR, "1")
    .err()
    .context("revision must not wrap")?;
  assert_eq!(error.to_string(), "catalog revision limit reached");
  assert_eq!(store.added_emotes(guild)?, [original]);
  assert_eq!(store.catalog_history(guild)?.current_revision, u64::MAX);
  Ok(())
}

#[test]
fn reports_corrupt_history_and_live_policy_during_inspection() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let guild = EDITOR.guild;
  let store = Store::open(&directory.path().join("corrupt-history.redb"))?;
  store.add_emote(EDITOR, example("Wave", "1"))?;
  let transaction = store.0.begin_write()?;
  transaction
    .open_table(REVISIONS)?
    .insert((guild, 1), "not metadata")?;
  transaction
    .open_table(SNAPSHOTS)?
    .insert((guild, 1), "not a snapshot")?;
  transaction
    .open_table(GUILD_EMOTES)?
    .insert(guild, "not a policy")?;
  transaction.commit()?;

  assert_matches!(store.catalog_history(guild), Err(_));
  assert_matches!(store.preview_restore(guild, 1), Err(_));
  assert_matches!(store.preview_restore(guild, 0), Err(_));
  store.invalidate_table("guild_emotes")?;
  assert_matches!(store.preview_restore(guild, 0), Err(_));
  assert_eq!(store.added_emotes(guild)?, [example("Wave", "1")]);
  Ok(())
}
