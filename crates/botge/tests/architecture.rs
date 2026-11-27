//! Enforces dependency direction and keeps fixture features out of production declarations.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Metadata failures and assertion panics describe architecture test failures"
)]

use std::{collections::BTreeMap, process::Command};

use anyhow::{Context as _, Result};
use serde_json::Value;

fn dependency_policy() -> BTreeMap<&'static str, &'static [&'static str]> {
  BTreeMap::from([
    (
      "botge",
      &[
        "botge-app",
        "botge-domain",
        "botge-storage",
        "botge-discord",
        "botge-activity",
        "botge-voice",
        "botge-quantum",
      ][..],
    ),
    ("botge-domain", &[][..]),
    ("botge-quantum", &["botge-domain"][..]),
    ("botge-quantum-certificate", &[][..]),
    ("botge-storage", &["botge-domain"][..]),
    ("botge-emotes", &["botge-domain"][..]),
    (
      "botge-app",
      &["botge-domain", "botge-storage", "botge-emotes"][..],
    ),
    (
      "botge-discord",
      &["botge-app", "botge-domain", "botge-quantum"][..],
    ),
    ("botge-activity", &["botge-app", "botge-domain"][..]),
    ("botge-voice", &["botge-app", "botge-domain"][..]),
    ("botge-test-support", &["botge-domain"][..]),
  ])
}

/// Names the only optional dependencies that may cross boundaries for fixtures.
fn fixture_dependency(owner: &str, target: &str) -> bool {
  matches!(
    (owner, target),
    ("botge-storage", "botge-test-support" | "tempfile")
      | ("botge-discord", "botge-test-support" | "axum")
  )
}

/// Traverses local feature aliases so production defaults cannot enable fixture capabilities.
fn production_features(package: &Value, owner: &str) -> Result<()> {
  let features = package
    .get("features")
    .and_then(Value::as_object)
    .context("missing features")?;
  let mut pending = vec!["default"];
  let mut visited = std::collections::BTreeSet::new();
  while let Some(feature) = pending.pop() {
    if !visited.insert(feature) {
      continue;
    }
    anyhow::ensure!(
      feature != "test-util"
        && !feature.ends_with("/test-util")
        && feature != "dep:botge-test-support",
      "Production defaults enable {feature}"
    );
    let dependency = feature
      .strip_prefix("dep:")
      .unwrap_or(feature)
      .split('/')
      .next()
      .unwrap_or_default()
      .trim_end_matches('?');
    anyhow::ensure!(
      !fixture_dependency(owner, dependency),
      "Production defaults enable fixture dependency {dependency}"
    );
    if let Some(children) = features.get(feature).and_then(Value::as_array) {
      for child in children {
        pending.push(child.as_str().context("invalid feature name")?);
      }
    }
  }
  Ok(())
}

/// Requires every package, including the executable, to live in the flat crates directory.
///
/// The certificate simulator is the one exception: it lives beside the other proofs of the quantum
/// specification.
fn sibling_manifest(metadata: &Value, package: &Value, name: &str) -> Result<()> {
  let workspace = metadata
    .get("workspace_root")
    .and_then(Value::as_str)
    .context("missing workspace root")?;
  let directory = if name == "botge-quantum-certificate" {
    std::path::Path::new(workspace).join("quantum/proofs/certificate")
  } else {
    std::path::Path::new(workspace).join("crates").join(name)
  };
  let expected = directory.join("Cargo.toml");
  assert_eq!(
    package.get("manifest_path").and_then(Value::as_str),
    expected.to_str(),
    "Workspace crates must be siblings under crates/"
  );
  Ok(())
}

#[test]
fn production_dependencies_follow_application_boundaries() -> Result<()> {
  let output = Command::new(env!("CARGO"))
    .args([
      "metadata",
      "--offline",
      "--locked",
      "--no-deps",
      "--format-version",
      "1",
    ])
    .output()?;
  anyhow::ensure!(output.status.success(), "Cargo metadata failed");
  let metadata: Value = serde_json::from_slice(&output.stdout)?;
  let packages = metadata
    .get("packages")
    .and_then(Value::as_array)
    .context("missing packages")?;
  let allowed = dependency_policy();
  assert_eq!(
    packages.len(),
    allowed.len(),
    "Review the architecture policy when adding a crate"
  );
  for package in packages {
    let name = package
      .get("name")
      .and_then(Value::as_str)
      .context("missing package name")?;
    sibling_manifest(&metadata, package, name)?;
    let edges = allowed
      .get(name)
      .context("workspace member missing an architecture policy")?;
    production_features(package, name)?;
    let dependencies = package
      .get("dependencies")
      .and_then(Value::as_array)
      .context("missing dependencies")?;
    for dependency in dependencies {
      if dependency.get("kind").and_then(Value::as_str) == Some("dev") {
        continue;
      }
      let target = dependency
        .get("name")
        .and_then(Value::as_str)
        .context("missing dependency name")?;
      let fixture = dependency.get("optional").and_then(Value::as_bool) == Some(true)
        && fixture_dependency(name, target);
      if fixture {
        continue;
      }
      if target.starts_with("botge-") {
        assert!(
          edges.contains(&target),
          "Forbidden production dependency: {name} -> {target}"
        );
      }
      let features = dependency
        .get("features")
        .and_then(Value::as_array)
        .context("missing feature list")?;
      assert!(
        !features
          .iter()
          .any(|feature| feature.as_str() == Some("test-util")),
        "Production dependency enables fixtures: {name} -> {target}"
      );
      let forbidden: &[&str] = match name {
        "botge-app" => &[
          "axum",
          "serenity",
          "songbird",
          "reqwest",
          "redb",
          "tokio-tungstenite",
        ],
        "botge-storage" => &["axum", "serenity", "songbird", "reqwest", "tokio"],
        "botge-emotes" => &["redb", "axum", "serenity", "songbird"],
        "botge-activity" => &["redb", "serenity", "songbird", "reqwest"],
        "botge-discord" => &["axum", "redb", "songbird"],
        "botge-voice" => &["axum", "redb", "reqwest"],
        "botge-quantum" => &["axum", "redb", "serenity", "songbird", "tokio-tungstenite"],
        "botge" => &["redb"],
        _ => &[],
      };
      assert!(
        !forbidden.contains(&target),
        "Infrastructure crossed a responsibility boundary: {name} -> {target}"
      );
      if name == "botge-domain" {
        assert!(
          matches!(target, "serde" | "url"),
          "Domain acquired an infrastructure dependency: {target}"
        );
      }
    }
  }
  Ok(())
}

#[test]
fn default_feature_aliases_cannot_activate_fixture_dependencies() -> Result<()> {
  for feature in [
    "dep:tempfile",
    "tempfile",
    "test-util",
    "botge-emotes/test-util",
  ] {
    let package = serde_json::json!({"features":{"default":["nested"],"nested":[feature]}});
    std::assert_matches!(production_features(&package, "botge-storage"), Err(_));
  }
  production_features(
    &serde_json::json!({"features":{"default":["ordinary"],"ordinary":["default"]}}),
    "botge-storage",
  )?;
  Ok(())
}
