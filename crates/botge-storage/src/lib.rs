//! Owns redb tables, validation before writes, and transaction boundaries.
//!
//! Methods are synchronous: async callers must use the blocking pool. Guild IDs key voice
//! settings, provider selections, and additions; user IDs key personal border preferences.
//!
//! The `meta` table records the schema version. Databases created before the marker existed
//! are treated as version 1 and stamped on their next open. A version this build does not
//! support is rejected before any other row is read or written.

use std::{num::NonZeroU64, path::Path};

use anyhow::{Context as _, Result};
use redb::{Database, ReadableDatabase as _, ReadableTable as _, TableDefinition};
use serde::{Serialize, de::DeserializeOwned};

use botge_domain::{
  emotes::{Emote, GuildEmotes},
  settings::VoiceSettings,
};

const VOICE_SETTINGS: TableDefinition<'static, NonZeroU64, &str> =
  TableDefinition::new("voice_settings");
const GUILD_EMOTES: TableDefinition<'static, NonZeroU64, &str> =
  TableDefinition::new("guild_emotes");
const ADDED_EMOTES: TableDefinition<'static, NonZeroU64, &str> =
  TableDefinition::new("added_emotes");
const EMOTE_BORDERS: TableDefinition<'static, NonZeroU64, u32> =
  TableDefinition::new("emote_borders");
const META: TableDefinition<'static, &str, u64> = TableDefinition::new("meta");
const SCHEMA_KEY: &str = "schema_version";
/// The table layout and JSON record shapes this build reads and writes.
///
/// Increment it together with a migration in [`Store::initialize`] when a saved shape changes
/// incompatibly. Older builds ignore the marker, so an image rollback still opens the file.
const SCHEMA_VERSION: u64 = 1;

/// Shares a redb handle across workers. Writes use database transactions through `&self`.
///
/// Voice settings, provider selections, and individual additions use guild IDs as keys.
/// Border colors use user IDs. Each write commits its own transaction. Run these blocking
/// operations off the async executor once the services are running.
#[derive(Debug)]
pub struct Store(Database);

/// Opens an offline backup read-only and reads all expected tables without creating a file.
///
/// # Errors
///
/// Returns an error if the backup cannot be opened read-only, an expected table is missing
/// or incompatible, a row cannot be read, or a stored JSON value cannot be decoded. A recorded
/// schema version this build does not support is also rejected; a backup without the marker
/// predates it and is accepted.
///
/// # Panics
///
/// Structurally corrupt pages can trigger a panic inside redb. Verify untrusted backups through
/// the `--verify-database` CLI in a separate process; its fatal panic hook rejects the backup.
pub fn verify_backup(path: &Path) -> Result<()> {
  let database = redb::ReadOnlyDatabase::open(path)?;
  let transaction = database.begin_read()?;
  let saved = match transaction.open_table(META) {
    Ok(table) => schema_version(&table)?,
    Err(redb::TableError::TableDoesNotExist(_)) => None,
    Err(error) => return Err(error.into()),
  };
  check_schema(saved)?;
  for definition in [VOICE_SETTINGS, GUILD_EMOTES, ADDED_EMOTES] {
    for row in transaction.open_table(definition)?.iter()? {
      let (_, value) = row?;
      drop(serde_json::from_str::<serde_json::Value>(value.value())?);
    }
  }
  transaction
    .open_table(EMOTE_BORDERS)?
    .iter()?
    .try_for_each(|row| row.map(drop))
    .map_err(Into::into)
}

impl Store {
  /// Creates or opens the database and verifies that the expected tables can be opened.
  ///
  /// # Errors
  ///
  /// Returns an error for an unusable path, incompatible table definitions, or a failed
  /// initialization transaction. The caller is responsible for creating the parent directory.
  pub fn open(path: &Path) -> Result<Self> {
    let db = Database::builder()
      .set_cache_size(8 * 1024 * 1024)
      .create(path)
      .with_context(|| format!("could not open {}", path.display()))?;
    Self::initialize(db)
  }

  /// Initializes the typed tables on an already opened redb handle.
  ///
  /// An unmarked database is stamped with the current schema version in the same transaction.
  ///
  /// # Errors
  ///
  /// Returns an error if a table has an incompatible schema, the recorded schema version is
  /// not supported by this build, or initialization cannot commit. A rejected database is
  /// left unchanged.
  fn initialize(db: Database) -> Result<Self> {
    let transaction = db.begin_write()?;
    {
      let mut meta = transaction.open_table(META)?;
      let saved = schema_version(&meta)?;
      check_schema(saved)?;
      if saved.is_none() {
        meta.insert(SCHEMA_KEY, SCHEMA_VERSION)?;
      }
    }
    transaction.open_table(VOICE_SETTINGS)?;
    transaction.open_table(GUILD_EMOTES)?;
    transaction.open_table(ADDED_EMOTES)?;
    transaction.open_table(EMOTE_BORDERS)?;
    transaction.commit().map(|()| Self(db)).map_err(Into::into)
  }

  /// Returns the user's packed RGB color, or `None` if no border is saved.
  ///
  /// # Errors
  ///
  /// Returns an error if the read transaction, table lookup, or row access fails.
  pub fn emote_border(&self, user: NonZeroU64) -> Result<Option<u32>> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(EMOTE_BORDERS)?;
    table
      .get(user)
      .map(|row| row.map(|row| row.value()))
      .map_err(Into::into)
  }

  /// Upserts a user preference or removes its row when the color is cleared.
  ///
  /// Callers must limit a supplied color to packed 24-bit RGB; this layer stores the value
  /// as received rather than revalidating the HTTP color syntax.
  ///
  /// # Errors
  ///
  /// Returns an error if the write transaction, table update, or commit fails.
  /// A successful return confirms that the preference was committed.
  pub fn save_emote_border(&self, user: NonZeroU64, color: Option<u32>) -> Result<()> {
    let transaction = self.0.begin_write()?;
    {
      let mut table = transaction.open_table(EMOTE_BORDERS)?;
      if let Some(color) = color {
        table.insert(user, color)?;
      } else {
        table.remove(user)?;
      }
    }
    transaction.commit()?;
    Ok(())
  }

  /// Defaults an absent row to no selected channel and reports malformed rows as errors.
  ///
  /// # Errors
  ///
  /// Returns an error if the database cannot be read or a saved row is malformed.
  /// An absent row uses defaults; a malformed row never silently falls back to defaults.
  pub fn voice_settings(&self, guild: NonZeroU64) -> Result<VoiceSettings> {
    let transaction = self.0.begin_read()?;
    read_json(&transaction.open_table(VOICE_SETTINGS)?, guild)
  }

  /// Validates the preference before replacing the existing row.
  ///
  /// # Errors
  ///
  /// Returns an error for invalid settings, JSON serialization failure, or a failed database
  /// transaction. Validation finishes before a write transaction is opened.
  pub fn save_voice_settings(&self, guild: NonZeroU64, settings: &VoiceSettings) -> Result<()> {
    anyhow::ensure!(settings.is_valid(), "invalid voice settings");
    self.save_json(VOICE_SETTINGS, guild, settings)
  }

  /// Reads a consistent snapshot for one pass of the voice worker.
  ///
  /// Returns only persisted rows. A malformed row fails the scan so the worker can log
  /// the error and retry on its next pass.
  ///
  /// # Errors
  ///
  /// Returns an error if the snapshot cannot be read or any saved row is malformed.
  /// No partial list is returned.
  pub fn all_voice_settings(&self) -> Result<Vec<(NonZeroU64, VoiceSettings)>> {
    self.read_all(VOICE_SETTINGS)
  }

  /// Decodes every row of a guild-keyed JSON table in one read transaction.
  ///
  /// # Errors
  ///
  /// Returns an error if the table cannot be read or a row cannot be decoded.
  fn read_all<T: DeserializeOwned>(
    &self,
    definition: TableDefinition<'static, NonZeroU64, &'static str>,
  ) -> Result<Vec<(NonZeroU64, T)>> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(definition)?;
    table
      .iter()?
      .map(|row| {
        let (guild, value) = row?;
        Ok((guild.value(), serde_json::from_str(value.value())?))
      })
      .collect()
  }

  /// Reads the guild's provider and access rules, defaulting only when the row is absent.
  ///
  /// # Errors
  ///
  /// Returns an error if the database cannot be read or a saved policy cannot be decoded.
  pub fn guild_emotes(&self, guild: NonZeroU64) -> Result<GuildEmotes> {
    let transaction = self.0.begin_read()?;
    read_json(&transaction.open_table(GUILD_EMOTES)?, guild)
  }

  /// Validates and replaces the guild's complete emote policy in one transaction.
  ///
  /// # Errors
  ///
  /// Returns an error for invalid policy values, serialization failure, or a failed write
  /// transaction. Invalid settings leave the existing row unchanged.
  pub fn save_guild_emotes(&self, guild: NonZeroU64, settings: &GuildEmotes) -> Result<()> {
    anyhow::ensure!(settings.valid(), "invalid guild emote settings");
    self.save_json(GUILD_EMOTES, guild, settings)
  }

  /// Lists the guilds whose saved policy selects `set_id` as their personal 7TV set.
  ///
  /// Reads every guild policy in one transaction; rows are few and small.
  ///
  /// # Errors
  ///
  /// Returns an error if the table cannot be read or a saved policy cannot be decoded.
  pub fn guilds_with_seven_tv_set(&self, set_id: &str) -> Result<Vec<NonZeroU64>> {
    Ok(
      self
        .read_all::<GuildEmotes>(GUILD_EMOTES)?
        .into_iter()
        .filter(|(_, policy)| policy.seven_tv_set.as_deref() == Some(set_id))
        .map(|(guild, _)| guild)
        .collect(),
    )
  }

  /// Returns the guild's individual additions in storage order, or an empty list.
  ///
  /// # Errors
  ///
  /// Returns an error if the saved additions cannot be read or decoded.
  pub fn added_emotes(&self, guild: NonZeroU64) -> Result<Vec<Emote>> {
    let transaction = self.0.begin_read()?;
    read_json(&transaction.open_table(ADDED_EMOTES)?, guild)
  }

  /// Returns `false` without writing if the addition conflicts or the guild list is full.
  ///
  /// Conflicts include a duplicate ID or a case-insensitive name match in the guild's saved
  /// additions. The transaction checks and appends under the same write lock.
  ///
  /// # Errors
  ///
  /// Returns an error if the saved list cannot be read, serialized, or committed.
  /// Duplicate or full-list rejection is reported as `Ok(false)`, not an error.
  pub fn add_emote(&self, guild: NonZeroU64, emote: Emote) -> Result<bool> {
    self.change_added(guild, move |entries| {
      if entries.len() >= 1000
        || entries
          .iter()
          .any(|entry| entry.id == emote.id || entry.name.eq_ignore_ascii_case(&emote.name))
      {
        return false;
      }
      entries.push(emote);
      true
    })
  }

  /// Removes the matching addition and returns whether a change was committed.
  ///
  /// # Errors
  ///
  /// Returns an error if the saved list cannot be read, serialized, or committed.
  /// An absent ID is reported as `Ok(false)`.
  pub fn remove_emote(&self, guild: NonZeroU64, id: &str) -> Result<bool> {
    self.change_added(guild, |entries| {
      let before = entries.len();
      entries.retain(|entry| entry.id != id);
      entries.len() != before
    })
  }

  /// Serializes a validated record before opening and committing its replacement transaction.
  ///
  /// # Errors
  ///
  /// Returns serialization, table, write or commit failures without a partial replacement.
  fn save_json(
    &self,
    definition: TableDefinition<'static, NonZeroU64, &str>,
    key: NonZeroU64,
    value: &impl Serialize,
  ) -> Result<()> {
    let value = serde_json::to_string(value)?;
    let transaction = self.0.begin_write()?;
    transaction
      .open_table(definition)?
      .insert(key, value.as_str())?;
    transaction.commit().map_err(Into::into)
  }

  /// Reads, edits, and commits the guild's list in one transaction to prevent lost updates.
  ///
  /// # Errors
  ///
  /// Returns an error if reading, serializing, or committing the list fails.
  /// If `change` returns `false`, the transaction is dropped without committing.
  fn change_added(
    &self,
    guild: NonZeroU64,
    change: impl FnOnce(&mut Vec<Emote>) -> bool,
  ) -> Result<bool> {
    let transaction = self.0.begin_write()?;
    {
      let mut table = transaction.open_table(ADDED_EMOTES)?;
      let mut entries = read_json(&table, guild)?;
      if !change(&mut entries) {
        return Ok(false);
      }
      let value = serde_json::to_string(&entries)?;
      let _previous = table.insert(guild, value.as_str())?;
    }
    transaction.commit()?;
    Ok(true)
  }
}

/// Reads the recorded schema version, or `None` for a database that predates the marker.
///
/// # Errors
///
/// Returns an error if the row lookup fails.
fn schema_version(table: &impl redb::ReadableTable<&'static str, u64>) -> Result<Option<u64>> {
  Ok(table.get(SCHEMA_KEY)?.map(|row| row.value()))
}

/// Accepts the current schema version and treats an absent marker as version 1.
///
/// # Errors
///
/// Returns an error naming the recorded version when this build cannot read it.
fn check_schema(saved: Option<u64>) -> Result<()> {
  let version = saved.unwrap_or(1);
  anyhow::ensure!(
    version == SCHEMA_VERSION,
    "database schema version {version} is not supported; this build reads version {SCHEMA_VERSION}"
  );
  Ok(())
}

/// Decodes a JSON record from either a read or a write transaction's open table.
///
/// # Errors
///
/// Returns an error if the row lookup fails or its JSON cannot be decoded.
/// An absent row produces the record type's default.
fn read_json<T: DeserializeOwned + Default>(
  table: &impl redb::ReadableTable<NonZeroU64, &'static str>,
  key: NonZeroU64,
) -> Result<T> {
  table.get(key)?.map_or_else(
    || Ok(T::default()),
    |row| serde_json::from_str(row.value()).map_err(Into::into),
  )
}

#[cfg(any(test, feature = "test-util"))]
mod tests;

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
