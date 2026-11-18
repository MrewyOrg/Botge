//! Stores personal border preferences under the identity returned by Discord OAuth.

use std::sync::Arc;

use axum::{
  Json,
  extract::State,
  http::{HeaderMap, StatusCode},
};
use serde::Deserialize;

use super::{Activity, ApiError, GuildAccess, ReadSettings};

/// A border update for the OAuth caller, with an empty color representing a clear.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveBorder {
  guild_id: String,
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
    _ => Err(ApiError::new(
      StatusCode::BAD_REQUEST,
      "Enter a six-digit hex color or leave it blank.",
    )),
  }
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
  let (_, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  Ok(border_response(
    state
      .application
      .read_border(&state.access, &credential)
      .await?,
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
  let (_, credential, _permit) = state.validate(&headers, &request.guild_id)?;
  let color = parse_border(&request.color)?;
  state
    .application
    .save_border(&state.access, &credential, color)
    .await?;
  Ok(border_response(color))
}

#[cfg(test)]
mod tests;
