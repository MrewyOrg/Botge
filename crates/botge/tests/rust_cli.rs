//! Runs the built executable to verify CLI output and errors that occur before a Discord connection.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use std::process::Command;

#[test]
fn maintenance_commands_fail_without_loading_discord_credentials() -> std::io::Result<()> {
  for arguments in [
    vec!["--verify-database"],
    vec!["--verify-database", "/missing/botge-backup.redb"],
  ] {
    let result = Command::new(env!("CARGO_BIN_EXE_botge"))
      .env_remove("DISCORD_TOKEN")
      .args(arguments)
      .output()?;
    assert!(!result.status.success());
    assert!(!String::from_utf8_lossy(&result.stderr).contains("DISCORD_TOKEN is required"));
  }
  Ok(())
}

#[test]
fn reports_version_without_a_discord_token() -> std::io::Result<()> {
  let result = Command::new(env!("CARGO_BIN_EXE_botge"))
    .env_remove("DISCORD_TOKEN")
    .arg("--version")
    .output()?;
  assert!(result.status.success());
  assert!(String::from_utf8_lossy(&result.stdout).starts_with("Botge "));
  Ok(())
}

#[test]
fn reports_missing_token_before_starting() -> std::io::Result<()> {
  let result = Command::new(env!("CARGO_BIN_EXE_botge"))
    .env_remove("DISCORD_TOKEN")
    .output()?;
  assert!(!result.status.success());
  assert!(String::from_utf8_lossy(&result.stderr).contains("DISCORD_TOKEN is required"));
  Ok(())
}

#[test]
fn rejects_invalid_configuration_before_connecting_to_discord() -> std::io::Result<()> {
  let directory = tempfile::tempdir()?;
  std::fs::write(directory.path().join("botge.config.json"), "invalid JSON")?;
  let result = Command::new(env!("CARGO_BIN_EXE_botge"))
    .current_dir(directory.path())
    .env("DISCORD_TOKEN", "fixture")
    .env("BOTGE_DATA_DIR", "data")
    .env_remove("DISCORD_ACTIVITY_CLIENT_SECRET")
    .env_remove("DISCORD_ACTIVITY_PUBLIC_KEY")
    .env_remove("LOCAL_CACHE_BASE")
    .env_remove("RUST_LOG")
    .output()?;
  assert!(!result.status.success());
  assert!(String::from_utf8_lossy(&result.stderr).contains("invalid configuration"));
  Ok(())
}

#[test]
fn healthcheck_uses_only_the_local_health_endpoint() -> std::io::Result<()> {
  let result = Command::new(env!("CARGO_BIN_EXE_botge"))
    .env_remove("DISCORD_TOKEN")
    .arg("--healthcheck")
    .output()?;
  // Readiness can succeed or fail depending on an existing local health listener.
  assert!(!String::from_utf8_lossy(&result.stderr).contains("DISCORD_TOKEN is required"));
  Ok(())
}

#[test]
fn rejects_corrupted_backup_pages_without_rewriting_the_backup() -> anyhow::Result<()> {
  use anyhow::Context as _;
  use botge_domain::settings::VoiceSettings;
  use std::{collections::BTreeSet, num::NonZeroU64};
  let directory = tempfile::tempdir()?;
  let original = directory.path().join("original.redb");
  {
    let store = botge_storage::Store::open(&original)?;
    for index in 1..=128 {
      let guild = NonZeroU64::new(index).context("invalid fixture guild")?;
      store.save_voice_settings(
        guild,
        &VoiceSettings {
          status_emoji: Some(format!("saved-{index}")),
          ..VoiceSettings::default()
        },
      )?;
    }
  }
  botge_storage::verify_backup(&original)?;
  let bytes = std::fs::read(&original)?;
  let pages: BTreeSet<_> = bytes
    .windows(6)
    .enumerate()
    .filter_map(|(offset, window)| (window == b"saved-").then_some(offset / 4096 * 4096))
    .collect();
  let path = directory.path().join("corrupted.redb");
  let mut rejected = 0;
  for offset in pages {
    let mut changed = bytes.clone();
    *changed.get_mut(offset).context("missing fixture page")? ^= 0xff;
    std::fs::write(&path, &changed)?;
    // Corrupt redb pages may raise a library panic. Production's panic hook must fail the
    // verifier process before import, rather than allowing that process to continue.
    let output = Command::new(env!("CARGO_BIN_EXE_botge"))
      .arg("--verify-database")
      .arg(&path)
      .env_remove("DISCORD_TOKEN")
      .output()?;
    if !output.status.success() {
      rejected += 1;
    }
    assert_eq!(std::fs::read(&path)?, changed);
  }
  assert!(
    rejected > 0,
    "verification accepted every corrupted data page"
  );
  assert_eq!(std::fs::read(&original)?, bytes);
  Ok(())
}
