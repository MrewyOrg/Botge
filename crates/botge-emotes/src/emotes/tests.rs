//! Checks provider facade policy and the lifetime of immutable fixture configuration.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use std::assert_matches;

use super::*;

#[tokio::test]
async fn rejects_disabled_or_invalid_additions_without_contacting_a_provider() -> Result<()> {
  let disabled = Emotes::new(Providers::default(), None)?;
  assert!(!disabled.added_emotes_enabled());
  assert!(
    disabled
      .fetch_added("01234567890123456789012345")
      .await?
      .is_none()
  );
  let mut enabled = Emotes::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    None,
  )?;
  assert!(enabled.added_emotes_enabled());
  assert!(enabled.fetch_added("invalid").await?.is_none());
  let old = enabled.events.clone();
  let shared = Arc::clone(&enabled.client);
  enabled.use_provider_fixture(reqwest::Url::parse("http://127.0.0.1:1")?);
  assert_eq!(enabled.events, old);
  drop(shared);
  enabled.use_provider_fixture(reqwest::Url::parse("http://127.0.0.1:1")?);
  assert_matches!(
    enabled.fetch_added("01234567890123456789012345").await,
    Err(_)
  );
  assert!(format!("{enabled:?}").contains("Emotes"));
  Ok(())
}
