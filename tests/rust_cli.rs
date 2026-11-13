//! Runs the built executable to verify CLI output and errors that occur before a Discord connection.

#![allow(
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
