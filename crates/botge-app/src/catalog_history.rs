//! Administrator-only catalog history, restore preview, and atomic restore confirmation.

use std::{num::NonZeroU64, sync::Arc};

use botge_domain::catalog_history::{CatalogHistory, CatalogPreview};
use botge_storage::{CatalogEditor, RestoreOutcome, RestoreScope};

use crate::{
  Application, CatalogChange,
  access::{AccessError, Credential, FailureKind, GuildAccess, user_id},
  operations::database,
};

const UNAVAILABLE: AccessError = AccessError(
  FailureKind::NotFound,
  "That catalog revision is no longer available.",
);

impl Application {
  /// Lists a guild's catalog history for an administrator.
  ///
  /// # Errors
  ///
  /// Returns authorization, Discord lookup, or storage failures.
  pub async fn catalog_history<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<CatalogHistory, AccessError> {
    self.authorize_settings(access, guild, credential).await?;
    let store = Arc::clone(&self.store);
    database(move || store.catalog_history(guild)).await
  }

  /// Shows the changes a restore would apply to the current managed catalog.
  ///
  /// # Errors
  ///
  /// Returns authorization and storage failures, or not-found for an unavailable revision.
  pub async fn preview_catalog_restore<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    revision: u64,
  ) -> Result<CatalogPreview, AccessError> {
    self.authorize_settings(access, guild, credential).await?;
    let store = Arc::clone(&self.store);
    database(move || store.preview_restore(guild, revision))
      .await?
      .ok_or(UNAVAILABLE)
  }

  /// Restores the selected revision if the administrator's preview is still current.
  ///
  /// # Errors
  ///
  /// Returns an authorization, policy, storage, stale-preview or unavailable-revision error.
  pub async fn restore_catalog<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    revision: u64,
    expected: u64,
  ) -> Result<u64, AccessError> {
    self.authorize_settings(access, guild, credential).await?;
    let actor = Some(user_id(access, credential).await?);
    let scope = if self.added_emotes_enabled() {
      RestoreScope::All
    } else {
      RestoreScope::SettingsOnly
    };
    let store = Arc::clone(&self.store);
    let outcome = database(move || {
      store.restore_catalog(CatalogEditor { guild, actor }, revision, expected, scope)
    })
    .await?;
    match outcome {
      RestoreOutcome::Restored(revision) => {
        self.catalog_changed(CatalogChange::Guild(guild));
        Ok(revision)
      }
      RestoreOutcome::Unchanged => Ok(expected),
      RestoreOutcome::Missing => Err(UNAVAILABLE),
      RestoreOutcome::Stale => Err(AccessError(
        FailureKind::Conflict,
        "The catalog changed. Open a new restore preview.",
      )),
      RestoreOutcome::Untracked => Err(AccessError(
        FailureKind::Conflict,
        "The catalog changed outside its history. Save a catalog edit before restoring.",
      )),
      RestoreOutcome::AdditionsDisabled => Err(AccessError(
        FailureKind::PermissionDenied,
        "This revision changes added emotes, which are disabled by the operator.",
      )),
    }
  }
}
