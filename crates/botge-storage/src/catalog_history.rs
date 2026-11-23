//! Records the managed catalog and its history in the same redb transaction.

use std::{num::NonZeroU64, ops::ControlFlow, time::SystemTime};

use anyhow::{Context as _, Result};
use botge_domain::catalog_history::{
  CatalogEdit, CatalogHistory, CatalogPreview, CatalogRevision, CatalogSnapshot,
};
use redb::{ReadableDatabase as _, ReadableTable, ReadableTableMetadata as _, TableDefinition};

use super::{ADDED_EMOTES, GUILD_EMOTES, Store, read_json};

/// Maximum stored snapshots per guild, including the newest committed revision.
pub(super) const RETAINED_REVISIONS: u64 = 32;
type RevisionKey = (NonZeroU64, u64);
const REVISIONS: TableDefinition<'static, RevisionKey, &str> =
  TableDefinition::new("catalog_revisions");
const SNAPSHOTS: TableDefinition<'static, RevisionKey, &str> =
  TableDefinition::new("catalog_snapshots");

/// A catalog mutation's guild and the authenticated user responsible for it.
#[derive(Clone, Copy, Debug)]
pub struct CatalogEditor {
  /// The guild being edited.
  pub guild: NonZeroU64,
  /// The Discord user, absent for a system write.
  pub actor: Option<NonZeroU64>,
}

impl CatalogEditor {
  /// Identifies a managed write made without a Discord actor.
  #[must_use]
  pub const fn system(guild: NonZeroU64) -> Self {
    Self { guild, actor: None }
  }
}

/// Which parts of an earlier revision are allowed to be restored by operator policy.
#[derive(Clone, Copy, Debug)]
pub enum RestoreScope {
  /// Restore policy and additions.
  All,
  /// Restore only when the additions already match.
  SettingsOnly,
}

/// What happened when an administrator confirmed a restore preview.
#[derive(Debug, Eq, PartialEq)]
pub enum RestoreOutcome {
  /// The committed revision number.
  Restored(u64),
  /// A different revision is now current, so the preview must be refreshed.
  Stale,
  /// The live catalog was changed outside its recorded history.
  Untracked,
  /// The selected revision is unavailable in this guild.
  Missing,
  /// The active state already matches the selected revision.
  Unchanged,
  /// The selected revision changes additions that the operator has disabled.
  AdditionsDisabled,
}

impl Store {
  /// Lists retained metadata newest first without reading catalog snapshots.
  ///
  /// # Errors
  ///
  /// Returns a storage error if metadata cannot be read or decoded.
  pub fn catalog_history(&self, guild: NonZeroU64) -> Result<CatalogHistory> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(REVISIONS)?;
    let revisions: Vec<CatalogRevision> = table
      .range((guild, 0)..=(guild, u64::MAX))?
      .rev()
      .map(|row| read_revision(row?.1.value()))
      .collect::<Result<_>>()?;
    let current_revision = revisions.first().map_or(0, |entry| entry.revision);
    Ok(CatalogHistory {
      current_revision,
      revisions,
    })
  }

  /// Compares a retained snapshot to the committed catalog inside one read transaction.
  ///
  /// # Errors
  ///
  /// Returns storage errors. An unavailable revision returns `None`.
  pub fn preview_restore(
    &self,
    guild: NonZeroU64,
    revision: u64,
  ) -> Result<Option<CatalogPreview>> {
    let transaction = self.0.begin_read()?;
    let snapshots = transaction.open_table(SNAPSHOTS)?;
    let Some(target) = snapshot(&snapshots, guild, revision)? else {
      return Ok(None);
    };
    let current = live_catalog(
      guild,
      &transaction.open_table(GUILD_EMOTES)?,
      &transaction.open_table(ADDED_EMOTES)?,
    )?;
    let current_revision = latest(&transaction.open_table(REVISIONS)?, guild)?.unwrap_or_default();
    Ok(Some(CatalogPreview::compare(
      current_revision,
      revision,
      &current,
      &target,
    )))
  }

  /// Restores an earlier snapshot if nothing has changed since the preview.
  ///
  /// # Errors
  ///
  /// Returns database or serialization failures without committing any changes.
  pub fn restore_catalog(
    &self,
    editor: CatalogEditor,
    revision: u64,
    expected: u64,
    scope: RestoreScope,
  ) -> Result<RestoreOutcome> {
    let guild = editor.guild;
    let transaction = self.0.begin_write()?;
    let Some(current_revision) = latest(&transaction.open_table(REVISIONS)?, guild)? else {
      return Ok(RestoreOutcome::Missing);
    };
    if current_revision != expected {
      return Ok(RestoreOutcome::Stale);
    }
    let Some(target) = snapshot(&transaction.open_table(SNAPSHOTS)?, guild, revision)? else {
      return Ok(RestoreOutcome::Missing);
    };
    let live = live_catalog(
      guild,
      &transaction.open_table(GUILD_EMOTES)?,
      &transaction.open_table(ADDED_EMOTES)?,
    )?;
    if live == target {
      return Ok(RestoreOutcome::Unchanged);
    }
    // A binary predating this history can write to the original tables after a rollback.
    let recorded = snapshot(&transaction.open_table(SNAPSHOTS)?, guild, current_revision)?;
    if recorded.as_ref() != Some(&live) {
      return Ok(RestoreOutcome::Untracked);
    }
    if matches!(scope, RestoreScope::SettingsOnly) && live.additions != target.additions {
      return Ok(RestoreOutcome::AdditionsDisabled);
    }
    commit_catalog(
      transaction,
      editor,
      current_revision,
      CatalogEdit::Restored { revision },
      &target,
    )
    .map(RestoreOutcome::Restored)
  }

  /// Applies one managed mutation and records its outcome atomically.
  ///
  /// # Errors
  ///
  /// Returns database, serialization, clock or revision-overflow errors.
  pub(super) fn edit_catalog<T>(
    &self,
    editor: CatalogEditor,
    change: impl FnOnce(&mut CatalogSnapshot) -> ControlFlow<T, (T, CatalogEdit)>,
  ) -> Result<T> {
    let guild = editor.guild;
    let transaction = self.0.begin_write()?;
    let mut catalog = live_catalog(
      guild,
      &transaction.open_table(GUILD_EMOTES)?,
      &transaction.open_table(ADDED_EMOTES)?,
    )?;
    let latest = latest(&transaction.open_table(REVISIONS)?, guild)?;
    if latest.is_none() {
      write_revision(
        &transaction,
        CatalogEditor { guild, actor: None },
        None,
        CatalogEdit::Baseline,
        &catalog,
      )?;
    }
    let (outcome, edit) = match change(&mut catalog) {
      ControlFlow::Break(outcome) => return Ok(outcome),
      ControlFlow::Continue(outcome) => outcome,
    };
    commit_catalog(
      transaction,
      editor,
      latest.unwrap_or_default(),
      edit,
      &catalog,
    )
    .map(|_| outcome)
  }
}

/// Commits an edit or a restore with the live tables it affects and its recorded revision.
///
/// # Errors
///
/// Returns encoding, transaction or revision errors without committing a partial catalog.
fn commit_catalog(
  transaction: redb::WriteTransaction,
  editor: CatalogEditor,
  previous: u64,
  edit: CatalogEdit,
  catalog: &CatalogSnapshot,
) -> Result<u64> {
  if matches!(edit, CatalogEdit::Settings | CatalogEdit::Restored { .. }) {
    write_live(&transaction, GUILD_EMOTES, editor.guild, &catalog.settings)?;
  }
  if !matches!(edit, CatalogEdit::Settings) {
    write_live(&transaction, ADDED_EMOTES, editor.guild, &catalog.additions)?;
  }
  let revision = write_revision(&transaction, editor, Some(previous), edit, catalog)?;
  transaction.commit().map(|()| revision).map_err(Into::into)
}

/// Writes one live catalog record in the caller's transaction.
///
/// # Errors
///
/// Returns an error if the record cannot be encoded or written.
fn write_live(
  transaction: &redb::WriteTransaction,
  definition: TableDefinition<'static, NonZeroU64, &str>,
  guild: NonZeroU64,
  record: &impl serde::Serialize,
) -> Result<()> {
  let encoded = serde_json::to_string(record)?;
  transaction
    .open_table(definition)?
    .insert(guild, encoded.as_str())
    .map(drop)
    .map_err(Into::into)
}

/// Opens the additive history tables on startup, including older databases.
///
/// # Errors
///
/// Returns a table or write transaction error.
pub(super) fn initialize(transaction: &redb::WriteTransaction) -> Result<()> {
  transaction.open_table(REVISIONS)?;
  transaction.open_table(SNAPSHOTS)?;
  Ok(())
}

/// Validates history records when present in an offline backup.
///
/// # Errors
///
/// Returns an error for incompatible tables, unreadable records or incomplete history.
pub(super) fn verify(transaction: &redb::ReadTransaction) -> Result<()> {
  match (
    transaction.open_table(REVISIONS),
    transaction.open_table(SNAPSHOTS),
  ) {
    (Ok(revisions), Ok(snapshots)) => {
      anyhow::ensure!(
        revisions.len()? == snapshots.len()?,
        "incomplete catalog history"
      );
      for row in revisions.iter()? {
        let (key, value) = row?;
        let (guild, revision) = key.value();
        let entry = read_revision(value.value())?;
        anyhow::ensure!(
          entry.revision == revision && snapshot(&snapshots, guild, revision)?.is_some(),
          "catalog revision and snapshot do not match"
        );
      }
    }
    (Err(redb::TableError::TableDoesNotExist(_)), Err(redb::TableError::TableDoesNotExist(_))) => {}
    (Err(error), _) | (_, Err(error)) => return Err(error.into()),
  }
  Ok(())
}

/// Decodes metadata stored for one revision.
///
/// # Errors
///
/// Returns a deserialization error if the saved metadata has an incompatible shape.
fn read_revision(value: &str) -> Result<CatalogRevision> {
  serde_json::from_str(value).map_err(Into::into)
}

/// Reads the two live tables in the caller's transaction.
///
/// # Errors
///
/// Returns read or decode errors.
fn live_catalog(
  guild: NonZeroU64,
  settings: &impl ReadableTable<NonZeroU64, &'static str>,
  additions: &impl ReadableTable<NonZeroU64, &'static str>,
) -> Result<CatalogSnapshot> {
  Ok(CatalogSnapshot {
    settings: read_json(settings, guild)?,
    additions: read_json(additions, guild)?,
  })
}

/// Finds the newest retained revision of one guild.
///
/// # Errors
///
/// Returns errors from the table range or latest row.
fn latest(
  table: &impl ReadableTable<RevisionKey, &'static str>,
  guild: NonZeroU64,
) -> Result<Option<u64>> {
  Ok(
    table
      .range((guild, 0)..=(guild, u64::MAX))?
      .next_back()
      .transpose()?
      .map(|(key, _)| key.value().1),
  )
}

/// Decodes one snapshot under its guild and revision key.
///
/// # Errors
///
/// Returns read or decode errors.
fn snapshot(
  table: &impl ReadableTable<RevisionKey, &'static str>,
  guild: NonZeroU64,
  revision: u64,
) -> Result<Option<CatalogSnapshot>> {
  table
    .get((guild, revision))?
    .map(|row| serde_json::from_str(row.value()))
    .transpose()
    .map_err(Into::into)
}

/// Writes one revision and removes its expired predecessor.
///
/// # Errors
///
/// Returns clock, overflow, encoding or storage errors.
fn write_revision(
  transaction: &redb::WriteTransaction,
  editor: CatalogEditor,
  previous: Option<u64>,
  edit: CatalogEdit,
  snapshot: &CatalogSnapshot,
) -> Result<u64> {
  let revision = match previous {
    Some(previous) => previous
      .checked_add(1)
      .context("catalog revision limit reached")?,
    None => 0,
  };
  let time = SystemTime::now()
    .duration_since(SystemTime::UNIX_EPOCH)?
    .as_secs();
  let metadata = serde_json::to_string(&CatalogRevision::new(revision, time, editor.actor, edit))?;
  let snapshot = serde_json::to_string(snapshot)?;
  let mut revisions = transaction.open_table(REVISIONS)?;
  let mut snapshots = transaction.open_table(SNAPSHOTS)?;
  let key = (editor.guild, revision);
  revisions.insert(key, metadata.as_str())?;
  snapshots.insert(key, snapshot.as_str())?;
  if let Some(expired) = revision.checked_sub(RETAINED_REVISIONS) {
    revisions.remove((editor.guild, expired))?;
    snapshots.remove((editor.guild, expired))?;
  }
  Ok(revision)
}

#[cfg(test)]
mod tests;
