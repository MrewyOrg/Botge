//! Verifies fixture failures remain observable instead of hiding malformed input or poisoned logs.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use std::{assert_matches, io::Write as _};

use super::*;

#[test]
fn validates_truncated_png_dimensions_and_non_utf8_log_bytes() -> Result<()> {
  let png = png_pixel()?;
  assert_eq!(png_dimensions(&png)?, (1, 1));
  for bytes in [
    &[][..],
    b"not a PNG".as_slice(),
    png.get(..8).context("missing header")?,
    png.get(..19).context("missing width")?,
    png.get(..23).context("missing height")?,
  ] {
    assert_matches!(png_dimensions(bytes), Err(_));
  }
  let mut logs = TestLogs::default();
  logs.write_all(&[0xff])?;
  logs.flush()?;
  assert_matches!(logs.text(), Err(_));
  Ok(())
}

#[test]
fn a_poisoned_log_lock_remains_a_failure_for_both_readers_and_writers() {
  let mut logs = TestLogs::default();
  let shared = logs.clone();
  let worker = std::thread::spawn(move || -> Result<()> {
    let _guard = shared
      .0
      .lock()
      .map_err(|_error| anyhow::anyhow!("fixture lock already poisoned"))?;
    #[expect(clippy::panic, reason = "Deliberately poisons only the fixture mutex")]
    {
      panic!("fixture poison");
    }
  });
  assert_matches!(worker.join(), Err(_));
  assert_matches!(logs.text(), Err(_));
  assert_matches!(logs.write(b"fixture"), Err(_));
}

#[test]
fn captures_legacy_logs_and_rejects_missing_tests_or_duplicate_initialization() -> Result<()> {
  let Some(logs) = legacy_logging_fixture(
    "tests::captures_legacy_logs_and_rejects_missing_tests_or_duplicate_initialization",
  )?
  else {
    return Ok(());
  };
  assert!(
    log::logger().enabled(
      &log::Metadata::builder()
        .level(log::Level::Warn)
        .target("fixture")
        .build()
    )
  );
  log::warn!("fixture legacy message");
  log::logger().flush();
  assert!(logs.text()?.contains("fixture legacy message"));
  assert_matches!(
    legacy_logging_fixture(
      "tests::captures_legacy_logs_and_rejects_missing_tests_or_duplicate_initialization"
    ),
    Err(_)
  );
  assert_matches!(legacy_logging_fixture("tests::missing_fixture"), Err(_));
  Ok(())
}

#[test]
fn reports_an_isolated_logging_test_failure_to_its_parent() -> Result<()> {
  const NAME: &str = "tests::reports_an_isolated_logging_test_failure_to_its_parent";
  if std::env::var("BOTGE_LEGACY_LOG_TEST").as_deref() == Ok(NAME) {
    anyhow::bail!("deliberate child fixture failure");
  }
  assert_matches!(legacy_logging_fixture(NAME), Err(_));
  Ok(())
}
