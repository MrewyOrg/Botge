use std::{num::NonZeroU64, path::Path};

use anyhow::{Context as _, Result};
use redb::{Database, ReadableDatabase as _, ReadableTable as _, TableDefinition};

use crate::{
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

/// Shares a redb handle across workers. Writes use database transactions through `&self`.
///
/// Voice settings, provider selections, and individual additions use guild IDs as keys.
/// Border colors use user IDs. Each write commits its own transaction. Run these blocking
/// operations off the async executor once the services are running.
pub(crate) struct Store(Database);

impl Store {
  /// Opens an offline backup read-only and reads all expected tables without creating a file.
  pub(crate) fn verify_backup(path: &Path) -> Result<()> {
    let database = redb::ReadOnlyDatabase::open(path)?;
    let transaction = database.begin_read()?;
    for definition in [VOICE_SETTINGS, GUILD_EMOTES, ADDED_EMOTES] {
      for row in transaction.open_table(definition)?.iter()? {
        let (_, value) = row?;
        let _: serde_json::Value = serde_json::from_str(value.value())?;
      }
    }
    for row in transaction.open_table(EMOTE_BORDERS)?.iter()? {
      let _ = row?;
    }
    Ok(())
  }

  /// Creates or opens the database and verifies that the expected tables can be opened.
  ///
  /// # Errors
  ///
  /// Returns an error for an unusable path, incompatible table definitions, or a failed
  /// initialization transaction. The caller is responsible for creating the parent directory.
  pub(crate) fn open(path: &Path) -> Result<Self> {
    let db = Database::builder()
      .set_cache_size(8 * 1024 * 1024)
      .create(path)
      .with_context(|| format!("could not open {}", path.display()))?;
    let transaction = db.begin_write()?;
    transaction.open_table(VOICE_SETTINGS)?;
    transaction.open_table(GUILD_EMOTES)?;
    transaction.open_table(ADDED_EMOTES)?;
    transaction.open_table(EMOTE_BORDERS)?;
    transaction.commit()?;
    Ok(Self(db))
  }

  /// Returns the user's packed RGB color, or `None` if no border is saved.
  pub(crate) fn emote_border(&self, user: NonZeroU64) -> Result<Option<u32>> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(EMOTE_BORDERS)?;
    Ok(table.get(user)?.map(|row| row.value()))
  }

  /// Upserts a user preference or removes its row when the color is cleared.
  pub(crate) fn save_emote_border(&self, user: NonZeroU64, color: Option<u32>) -> Result<()> {
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
  pub(crate) fn voice_settings(&self, guild: NonZeroU64) -> Result<VoiceSettings> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(VOICE_SETTINGS)?;
    match table.get(guild)? {
      Some(row) => Ok(serde_json::from_str(row.value())?),
      None => Ok(VoiceSettings::default()),
    }
  }

  /// Validates the preference before replacing the existing row.
  pub(crate) fn save_voice_settings(
    &self,
    guild: NonZeroU64,
    settings: &VoiceSettings,
  ) -> Result<()> {
    anyhow::ensure!(settings.is_valid(), "invalid voice settings");
    let value = serde_json::to_string(settings)?;
    let transaction = self.0.begin_write()?;
    transaction
      .open_table(VOICE_SETTINGS)?
      .insert(guild, value.as_str())?;
    transaction.commit()?;
    Ok(())
  }

  /// Reads a consistent snapshot for one pass of the voice worker.
  ///
  /// Returns only persisted rows. A malformed row fails the scan so the worker can log
  /// the error and retry on its next pass.
  pub(crate) fn all_voice_settings(&self) -> Result<Vec<(NonZeroU64, VoiceSettings)>> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(VOICE_SETTINGS)?;
    table
      .iter()?
      .map(|row| {
        let (guild, settings) = row?;
        Ok((guild.value(), serde_json::from_str(settings.value())?))
      })
      .collect()
  }

  /// Reads the guild's provider and access rules, defaulting only when the row is absent.
  pub(crate) fn guild_emotes(&self, guild: NonZeroU64) -> Result<GuildEmotes> {
    let transaction = self.0.begin_read()?;
    let table = transaction.open_table(GUILD_EMOTES)?;
    match table.get(guild)? {
      Some(row) => Ok(serde_json::from_str(row.value())?),
      None => Ok(GuildEmotes::default()),
    }
  }

  /// Validates and replaces the guild's complete emote policy in one transaction.
  pub(crate) fn save_guild_emotes(&self, guild: NonZeroU64, settings: &GuildEmotes) -> Result<()> {
    anyhow::ensure!(settings.valid(), "invalid guild emote settings");
    let value = serde_json::to_string(settings)?;
    let transaction = self.0.begin_write()?;
    transaction
      .open_table(GUILD_EMOTES)?
      .insert(guild, value.as_str())?;
    transaction.commit()?;
    Ok(())
  }

  /// Returns the guild's individual additions in storage order, or an empty list.
  pub(crate) fn added_emotes(&self, guild: NonZeroU64) -> Result<Vec<Emote>> {
    let transaction = self.0.begin_read()?;
    read_emotes(&transaction.open_table(ADDED_EMOTES)?, guild)
  }

  /// Returns `false` without writing if the addition conflicts or the guild list is full.
  ///
  /// Conflicts include a duplicate ID or a case-insensitive name match in the guild's saved
  /// additions. The transaction checks and appends under the same write lock.
  pub(crate) fn add_emote(&self, guild: NonZeroU64, emote: Emote) -> Result<bool> {
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
  pub(crate) fn remove_emote(&self, guild: NonZeroU64, id: &str) -> Result<bool> {
    self.change_added(guild, |entries| {
      let before = entries.len();
      entries.retain(|entry| entry.id != id);
      entries.len() != before
    })
  }

  /// Reads, edits, and commits the guild's list in one transaction to prevent lost updates.
  fn change_added(
    &self,
    guild: NonZeroU64,
    change: impl FnOnce(&mut Vec<Emote>) -> bool,
  ) -> Result<bool> {
    let transaction = self.0.begin_write()?;
    {
      let mut table = transaction.open_table(ADDED_EMOTES)?;
      let mut entries = read_emotes(&table, guild)?;
      if !change(&mut entries) {
        return Ok(false);
      }
      let value = serde_json::to_string(&entries)?;
      table.insert(guild, value.as_str())?;
    }
    transaction.commit()?;
    Ok(true)
  }
}

/// Decodes the additions from either a read or a write transaction's open table.
fn read_emotes(
  table: &impl redb::ReadableTable<NonZeroU64, &'static str>,
  guild: NonZeroU64,
) -> Result<Vec<Emote>> {
  match table.get(guild)? {
    Some(row) => Ok(serde_json::from_str(row.value())?),
    None => Ok(vec![]),
  }
}

#[cfg(test)]
mod tests;
