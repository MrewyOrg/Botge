//! Checks canonical Discord IDs and independent validation of channel/status preferences.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use super::*;

#[test]
fn accepts_canonical_snowflakes() {
  assert_eq!(discord_id("42"), NonZeroU64::new(42));
  for value in ["0", "0042", "+42", " 42", "18446744073709551616"] {
    assert_eq!(discord_id(value), None);
  }
}

#[test]
fn validates_channel_and_status_independently() {
  let mut settings = VoiceSettings {
    channel_id: Some("42".into()),
    status_emoji: Some("<:botge:123>".into()),
    status_enabled: false,
  };
  assert!(settings.is_valid());
  assert_eq!(settings.status(), None);

  settings.status_enabled = true;
  assert_eq!(settings.status(), Some("<:botge:123>"));

  settings.channel_id = Some("bad".into());
  assert!(!settings.is_valid());

  settings.channel_id = None;
  for invalid in [String::new(), "hello\nworld".into(), "x".repeat(129)] {
    settings.status_emoji = Some(invalid);
    assert!(!settings.is_valid());
  }
  assert!(VoiceSettings::default().is_valid());
}
