//! Checks option bounds without clamping, secret redaction and strict sidecar decoding.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe test failures"
)]

use super::*;

#[test]
fn accepts_steps_and_sizes_only_inside_their_ranges() {
  assert_eq!(Steps::default().get(), 3);
  assert_eq!(Size::default().get(), 2);
  for value in 1..=6 {
    assert_eq!(
      Steps::try_from(value).map(Steps::get),
      Ok(u8::try_from(value).unwrap_or(0))
    );
  }
  for value in 1..=4 {
    assert_eq!(
      Size::try_from(value).map(Size::get),
      Ok(u16::try_from(value).unwrap_or(0))
    );
  }
  for value in [i64::MIN, -1, 0, 7, 256, i64::MAX] {
    assert_eq!(
      Steps::try_from(value).map_err(|error| error.to_string()),
      Err("Choose steps from 1 to 6.".to_owned())
    );
  }
  for value in [i64::MIN, -1, 0, 5, 65_537, i64::MAX] {
    assert_eq!(
      Size::try_from(value).map_err(|error| error.to_string()),
      Err("Choose size from 1 to 4.".to_owned())
    );
  }
}

#[test]
fn treats_blank_secrets_as_absent_and_never_prints_them() {
  assert_eq!(Secret::new(""), None);
  assert_eq!(Secret::new(" \t"), None);
  assert_eq!(
    Secret::new(" hunter2\n").as_ref().map(Secret::expose),
    Some("hunter2")
  );
  let secret = Secret::new("hunter2");
  assert_eq!(secret.as_ref().map(Secret::expose), Some("hunter2"));
  let debug = format!("{secret:?}");
  assert!(!debug.contains("hunter2"));
  assert!(debug.contains("redacted"));
}

#[test]
fn serializes_the_request_with_the_sidecar_field_names() -> serde_json::Result<()> {
  let request = EntangleRequest {
    base_pool_size: 257,
    overlay_pool_size: 65,
    steps: Steps(5),
  };
  assert_eq!(
    serde_json::to_value(request)?,
    serde_json::json!({"base_pool_size": 257, "overlay_pool_size": 65, "steps": 5})
  );
  Ok(())
}

#[test]
fn decodes_only_the_exact_sidecar_response() {
  let decode = |text: &str| serde_json::from_str::<Sample>(text).ok();
  assert_eq!(
    decode(r#"{"mode":"entangle","qubits":16,"base_index":3,"overlay_index":7}"#),
    Some(Sample {
      _mode: Mode::Entangle,
      qubits: 16,
      base_index: 3,
      overlay_index: 7,
    })
  );
  for text in [
    r#"{"mode":"random","qubits":16,"base_index":3,"overlay_index":7}"#,
    r#"{"qubits":16,"base_index":3,"overlay_index":7}"#,
    r#"{"mode":"entangle","qubits":16,"base_index":3}"#,
    r#"{"mode":"entangle","qubits":16,"base_index":-1,"overlay_index":7}"#,
    r#"{"mode":"entangle","qubits":16,"base_index":3.5,"overlay_index":7}"#,
    r#"{"mode":"entangle","qubits":16,"base_index":3,"overlay_index":7,"seed":1}"#,
    "[]",
  ] {
    assert_eq!(decode(text), None, "{text}");
  }
}

#[test]
fn labels_are_distinct_and_every_failure_says_nothing_was_drawn() {
  let errors = [
    QuantumError::Busy,
    QuantumError::Unavailable,
    QuantumError::Refused,
    QuantumError::Exhausted,
    QuantumError::Invalid,
  ];
  let labels: std::collections::HashSet<_> = errors.iter().map(|error| error.label()).collect();
  assert_eq!(labels.len(), errors.len());
  for error in errors {
    let label = error.label();
    assert!(
      !label.is_empty()
        && label
          .bytes()
          .all(|byte| byte.is_ascii_lowercase() || byte == b'_'),
      "{label}"
    );
    assert!(error.to_string().contains("No emote was drawn"), "{error}");
  }
}
