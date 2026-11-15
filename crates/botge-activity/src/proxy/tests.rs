//! Signs deterministic payloads to isolate signature, timestamp, and expiration checks.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use axum::http::HeaderValue;
use ed25519_dalek::{Signer as _, SigningKey};

use super::*;

/// Signs the fixture payload while leaving the timestamp header independently controllable.
fn signed_headers(payload: &str, timestamp: u64, hex_signature: bool) -> HeaderMap {
  let key = SigningKey::from_bytes(&[42; 32]);
  let signature = key.sign(payload.as_bytes()).to_bytes();
  let signature = if hex_signature {
    hex::encode(signature)
  } else {
    URL_SAFE_NO_PAD.encode(signature)
  };
  let mut headers = HeaderMap::new();
  headers.insert(
    "x-signature-ed25519",
    HeaderValue::from_str(&signature).unwrap(),
  );
  headers.insert(
    "x-discord-proxy-payload",
    HeaderValue::from_str(&STANDARD.encode(payload)).unwrap(),
  );
  headers.insert("x-signature-timestamp", HeaderValue::from(timestamp));
  headers
}

#[test]
fn accepts_only_valid_signatures_and_current_claims() -> anyhow::Result<()> {
  let key = SigningKey::from_bytes(&[42; 32]).verifying_key();
  let verifier = ProxyAuthenticator::new(&hex::encode(key.as_bytes()))?;
  std::assert_matches!(ProxyAuthenticator::new("aa"), Err(_));
  let claims = r#"{"created_at":100,"expires_at":160}"#;
  for hex_signature in [false, true] {
    assert!(verifier.verify(&signed_headers(claims, 100, hex_signature), 120));
  }
  assert!(!verifier.verify(&HeaderMap::new(), 120));
  assert!(!verifier.verify(&signed_headers(claims, 99, false), 120));
  assert!(!verifier.verify(&signed_headers(claims, 100, false), 160));
  assert!(!verifier.verify(&signed_headers(claims, 100, false), 69));
  assert!(!verifier.verify(&signed_headers("not JSON", 100, false), 120));
  let mut altered = signed_headers(claims, 100, false);
  altered.insert("x-discord-proxy-payload", HeaderValue::from_static("e30="));
  assert!(!verifier.verify(&altered, 120));
  Ok(())
}

#[test]
fn malformed_signature_encodings_do_not_bypass_signed_payload_validation() -> anyhow::Result<()> {
  let key = SigningKey::from_bytes(&[42; 32]).verifying_key();
  let verifier = ProxyAuthenticator::new(&hex::encode(key.as_bytes()))?;
  let claims = r#"{"created_at":100,"expires_at":160}"#;
  for encoded in [
    "g".repeat(128),
    "%".repeat(128),
    STANDARD.encode([0; 63]),
    STANDARD.encode([0; 65]),
  ] {
    let mut headers = signed_headers(claims, 100, true);
    headers.insert("x-signature-ed25519", HeaderValue::from_str(&encoded)?);
    assert!(!verifier.verify(&headers, 120));
  }
  let mut headers = signed_headers(claims, 100, true);
  headers.insert("x-discord-proxy-payload", HeaderValue::from_static("%"));
  assert!(!verifier.verify(&headers, 120));
  std::assert_matches!(ProxyAuthenticator::new("not hexadecimal"), Err(_));
  Ok(())
}
