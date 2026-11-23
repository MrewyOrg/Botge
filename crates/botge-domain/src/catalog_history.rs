//! Saved guild catalog revisions and the differences shown before restoring them.

use std::{
  collections::{HashMap, HashSet},
  num::NonZeroU64,
};

use serde::{Deserialize, Serialize};

use crate::emotes::{Emote, GuildEmotes};

/// Managed catalog data. Live provider feeds are outside a saved revision.
#[derive(Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct CatalogSnapshot {
  /// Saved 7TV set and addition-management policy.
  pub settings: GuildEmotes,
  /// Individually saved emotes in catalog order.
  pub additions: Vec<Emote>,
}

/// The action that created a revision. A restore creates a new revision.
#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
  tag = "type",
  rename_all = "camelCase",
  rename_all_fields = "camelCase"
)]
pub enum CatalogEdit {
  /// The saved catalog before history began.
  Baseline,
  /// A member added an emote.
  Added {
    /// The added 7TV emote ID.
    emote_id: String,
    /// The name saved at the time of the edit.
    name: String,
  },
  /// A member removed an emote.
  Removed {
    /// The removed 7TV emote ID.
    emote_id: String,
    /// The name saved before removal.
    name: String,
  },
  /// An administrator replaced the saved policy.
  Settings,
  /// An administrator restored an earlier snapshot.
  Restored {
    /// The revision used as the restore source.
    revision: u64,
  },
}

/// The lightweight metadata displayed in a guild's catalog history.
#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRevision {
  /// The revision number within this guild.
  pub revision: u64,
  /// Unix seconds at which Botge recorded the revision.
  pub recorded_at: u64,
  /// Discord account ID. Baselines and system writes have no actor.
  pub actor_id: Option<String>,
  /// What changed to create this revision.
  pub edit: CatalogEdit,
}

impl CatalogRevision {
  /// Records the identity and time supplied by the transaction's caller.
  #[must_use]
  pub fn new(
    revision: u64,
    recorded_at: u64,
    actor: Option<NonZeroU64>,
    edit: CatalogEdit,
  ) -> Self {
    Self {
      revision,
      recorded_at,
      actor_id: actor.map(|id| id.to_string()),
      edit,
    }
  }
}

/// The current revision and its retained history, newest first.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogHistory {
  /// The revision a restore must still see when it applies.
  pub current_revision: u64,
  /// Revisions available within the retention window.
  pub revisions: Vec<CatalogRevision>,
}

/// The changes that would be applied when restoring a saved revision.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPreview {
  /// The revision that must still be current on confirmation.
  pub current_revision: u64,
  /// The older revision selected for restore.
  pub target_revision: u64,
  /// Names of emotes that would be added.
  pub added: Vec<String>,
  /// Names of emotes that would be removed.
  pub removed: Vec<String>,
  /// Names of retained emotes whose recorded details would change.
  pub updated: Vec<String>,
  /// Whether the relative precedence of common emotes would change.
  pub order_changed: bool,
  /// The active policy shown for comparison.
  pub current_settings: GuildEmotes,
  /// The policy that would be restored.
  pub restored_settings: GuildEmotes,
}

impl CatalogPreview {
  /// Compares managed entries by ID and preserves catalog order in the resulting lists.
  #[must_use]
  pub fn compare(
    current_revision: u64,
    target_revision: u64,
    current: &CatalogSnapshot,
    target: &CatalogSnapshot,
  ) -> Self {
    let current_ids: HashMap<_, _> = current
      .additions
      .iter()
      .enumerate()
      .map(|(position, entry)| (entry.id.as_str(), position))
      .collect();
    let target_ids: HashSet<_> = target
      .additions
      .iter()
      .map(|entry| entry.id.as_str())
      .collect();
    let common_order = target
      .additions
      .iter()
      .filter_map(|entry| current_ids.get(entry.id.as_str()));
    Self {
      current_revision,
      target_revision,
      added: target
        .additions
        .iter()
        .filter(|entry| !current_ids.contains_key(entry.id.as_str()))
        .map(|entry| entry.name.clone())
        .collect(),
      removed: current
        .additions
        .iter()
        .filter(|entry| !target_ids.contains(entry.id.as_str()))
        .map(|entry| entry.name.clone())
        .collect(),
      updated: target
        .additions
        .iter()
        .filter(|entry| {
          current_ids
            .get(entry.id.as_str())
            .and_then(|position| current.additions.get(*position))
            .is_some_and(|previous| previous != *entry)
        })
        .map(|entry| entry.name.clone())
        .collect(),
      order_changed: !common_order.is_sorted(),
      current_settings: current.settings.clone(),
      restored_settings: target.settings.clone(),
    }
  }
}
