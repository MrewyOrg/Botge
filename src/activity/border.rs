//! Stores personal border preferences under the identity returned by Discord OAuth.

use std::{num::NonZeroU64, sync::Arc, time::Duration};

use axum::{
  Json,
  extract::State,
  http::{HeaderMap, StatusCode},
};
use serde::Deserialize;

use super::{Activity, ApiError, Credential, GuildAccess, ReadSettings, database};

/// A border update for the OAuth caller, with an empty color representing a clear.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveBorder {
  guild_id: String,
  #[serde(default)]
  code: String,
  color: String,
}

/// Parses a six-digit RGB color with an optional `#`. Blank input clears the preference.
///
/// # Errors
///
/// Returns a bad-request error unless trimming and removing an optional leading hash
/// leaves either an empty value or exactly six hexadecimal digits.
fn parse_border(color: &str) -> Result<Option<u32>, ApiError> {
  let color = color.trim();
  let color = color.strip_prefix('#').unwrap_or(color);
  match color {
    "" => Ok(None),
    hex if hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
      u32::from_str_radix(hex, 16)
        .map(Some)
        .map_err(|_error| ApiError::INVALID)
    }
    _ => Err(ApiError(
      StatusCode::BAD_REQUEST,
      "Enter a six-digit hex color or leave it blank.",
    )),
  }
}

/// Resolves the caller's account for a preference shared across guilds.
///
/// # Errors
///
/// Returns a credential or Discord lookup error, or an upstream error after 20 seconds.
async fn border_user<A: GuildAccess>(
  state: &Activity<A>,
  credential: &Credential,
) -> Result<NonZeroU64, ApiError> {
  tokio::time::timeout(Duration::from_secs(20), state.access.user_id(credential))
    .await
    .map_err(ApiError::upstream)?
}

/// Serializes the preference as uppercase hex without a leading `#`, or an empty string.
fn border_response(color: Option<u32>) -> Json<serde_json::Value> {
  Json(
    serde_json::json!({ "color": color.map_or_else(String::new, |color| format!("{color:06X}")) }),
  )
}

/// Loads the authenticated user's border preference for use across guilds.
///
/// # Errors
///
/// Returns input, proxy, admission, identity, or database errors. An absent preference is
/// serialized as an empty color.
pub(super) async fn read_border<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<ReadSettings>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (_, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let user = border_user(&state, &credential).await?;
  let store = Arc::clone(&state.store);
  Ok(border_response(
    database(move || store.emote_border(user)).await?,
  ))
}

/// Replaces or clears the authenticated user's border preference.
///
/// The owner comes from Discord's OAuth response. The request cannot select another user.
///
/// # Errors
///
/// Returns input, proxy, admission, identity, color-validation, or database errors. The
/// credential determines ownership independently of the request body.
pub(super) async fn save_border<A: GuildAccess>(
  State(state): State<Arc<Activity<A>>>,
  headers: HeaderMap,
  Json(request): Json<SaveBorder>,
) -> Result<Json<serde_json::Value>, ApiError> {
  let (_, credential, _permit) = state.validate(&headers, &request.guild_id, &request.code)?;
  let user = border_user(&state, &credential).await?;
  let color = parse_border(&request.color)?;
  let store = Arc::clone(&state.store);
  database(move || store.save_emote_border(user, color)).await?;
  Ok(border_response(color))
}

#[cfg(test)]
mod tests;
