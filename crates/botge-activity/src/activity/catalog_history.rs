//! Routes for listing, previewing, and restoring managed catalog revisions.

use std::sync::Arc;

use axum::{Json, extract::State, http::HeaderMap};
use botge_domain::catalog_history::{CatalogHistory, CatalogPreview};
use serde::{Deserialize, Serialize};

use super::{Activity, ApiError, GuildAccess, ReadSettings};

/// Selects a single saved revision of a guild's catalog.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SelectRevision {
  guild_id: String,
  revision: u64,
}

/// Confirms the earlier preview against the expected current revision.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ConfirmRestore {
  guild_id: String,
  revision: u64,
  expected_revision: u64,
}

/// The current revision after a successful restore.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RestoredCatalog {
  current_revision: u64,
}

/// Lists a guild's managed catalog revisions.
///
/// # Errors
///
/// Returns request admission, authentication, authorization or storage errors.
pub(super) async fn list<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<CatalogHistory>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let history = state
    .application
    .catalog_history(&state.access, guild, &credential)
    .await?;
  Ok(Json(history))
}

/// Previews the effect of restoring a particular revision.
///
/// # Errors
///
/// Returns request admission, authentication, authorization, missing-revision or storage errors.
pub(super) async fn preview<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SelectRevision>,
) -> Result<Json<CatalogPreview>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let preview = state
    .application
    .preview_catalog_restore(&state.access, guild, &credential, request.revision)
    .await?;
  Ok(Json(preview))
}

/// Confirms the preview and returns the current revision after the commit.
///
/// # Errors
///
/// Returns request admission, authentication, authorization, missing-revision, stale-preview
/// or storage errors.
pub(super) async fn restore<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ConfirmRestore>,
) -> Result<Json<RestoredCatalog>, ApiError> {
  let (guild, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let current_revision = state
    .application
    .restore_catalog(
      &state.access,
      guild,
      &credential,
      request.revision,
      request.expected_revision,
    )
    .await?;
  Ok(Json(RestoredCatalog { current_revision }))
}
