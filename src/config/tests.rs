use super::*;

#[test]
fn subscribes_to_set_updates_only_when_set_sources_are_enabled() {
  assert!(
    !Providers {
      seven_added: true,
      ..Default::default()
    }
    .watches_seven_tv_sets()
  );
  assert!(
    Providers {
      seven_global: true,
      ..Default::default()
    }
    .watches_seven_tv_sets()
  );
  assert!(
    Providers {
      seven_personal: true,
      ..Default::default()
    }
    .watches_seven_tv_sets()
  );
}

#[test]
fn reads_existing_jsonc_switches_and_uses_safe_defaults() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let path = dir.path().join("botge.config.json");
  assert!(!Config::load(&path)?.general.seven_added);
  assert!(Config::load(dir.path()).is_err());
  fs::write(
    &path,
    r#"{"general": { "use7TVAddedEmotes": true, }, /* compatibility */ }"#,
  )?;
  let config = Config::load(&path)?;
  assert!(config.general.seven_added);
  assert!(!config.general.seven_global);
  fs::write(&path, r#"{general: {"use7TVAddedEmotes": "yes"}}"#)?;
  assert!(Config::load(&path).is_err());
  Ok(())
}
