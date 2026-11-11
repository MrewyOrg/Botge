use super::*;
use axum::http::HeaderValue;
use ed25519_dalek::{Signer as _, SigningKey};

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
  assert!(ProxyAuthenticator::new("aa").is_err());
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
