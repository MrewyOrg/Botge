//! Verifies Discord's signed Activity proxy payload and its time window.
//!
//! A valid signature authenticates the proxy, not the OAuth caller or guild permissions.
//! Those checks belong to the Activity handlers and Discord adapter.

use axum::http::HeaderMap;
use base64::{
  Engine as _,
  engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD},
};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;

const CLOCK_SKEW_SECONDS: u64 = 30;

/// The signed time window expressed in Unix seconds.
#[derive(Deserialize)]
struct Claims {
  created_at: u64,
  expires_at: u64,
}

/// Verifies Discord Activity proxy signatures and rejects stale claims before OAuth runs.
pub(crate) struct ProxyAuthenticator(VerifyingKey);

impl ProxyAuthenticator {
  /// Decodes the configured Ed25519 public key from exactly 32 hex-encoded bytes.
  pub(crate) fn new(public_key: &str) -> anyhow::Result<Self> {
    let bytes = <[u8; 32]>::try_from(hex::decode(public_key)?)
      .map_err(|_| anyhow::anyhow!("Discord proxy public key must be 32 bytes"))?;
    Ok(Self(VerifyingKey::from_bytes(&bytes)?))
  }

  /// Checks the signature, matches the timestamp header to its signed claim, and enforces expiry.
  ///
  /// `now` is the caller's current Unix timestamp in seconds. The creation time can be up to
  /// 30 seconds ahead to allow clock skew. Expiration must be later than both `now` and the
  /// creation time. Guild membership and permissions are checked separately by the handler.
  pub(crate) fn verify(&self, headers: &HeaderMap, now: u64) -> bool {
    let Some((signature, payload)) = signed_bytes(headers) else {
      return false;
    };
    if self.0.verify_strict(&payload, &signature).is_err() {
      return false;
    }
    let Ok(claims) = serde_json::from_slice::<Claims>(&payload) else {
      return false;
    };
    header(headers, "x-signature-timestamp") == Some(claims.created_at.to_string().as_str())
      && claims.created_at <= now.saturating_add(CLOCK_SKEW_SECONDS)
      && claims.expires_at > now.max(claims.created_at)
  }
}

/// Reads a header only when its value can be interpreted as text.
fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
  headers.get(name)?.to_str().ok()
}

/// Accepts standard or URL-safe Base64, with or without padding.
fn decode_base64(value: &str) -> Option<Vec<u8>> {
  [STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD]
    .iter()
    .find_map(|encoding| encoding.decode(value).ok())
}

/// Extracts the signature and the original decoded payload bytes for verification.
fn signed_bytes(headers: &HeaderMap) -> Option<(Signature, Vec<u8>)> {
  let encoded = header(headers, "x-signature-ed25519")?;
  let decoded = if encoded.len() == 128 && encoded.bytes().all(|byte| byte.is_ascii_hexdigit()) {
    hex::decode(encoded).ok()
  } else {
    decode_base64(encoded)
  }?;
  let signature = Signature::from_slice(&decoded).ok()?;
  let payload = decode_base64(header(headers, "x-discord-proxy-payload")?)?;
  Some((signature, payload))
}

#[cfg(test)]
#[expect(
  clippy::unwrap_used,
  reason = "Fixture headers use known ASCII encodings"
)]
mod tests;
