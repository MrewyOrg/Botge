//! Pure validation, matching and browser catalog behavior.
#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture errors and assertion panics describe failures"
)]
use anyhow::Result;
use serde_json::Value;

use super::*;

/// Builds a static 7TV addition with a production-shaped CDN URL for fixture tests.
pub(crate) fn example(name: &str, id: &str) -> Emote {
  Emote {
    id: id.into(),
    name: name.into(),
    source: Source::SevenTv,
    image: format!("https://cdn.7tv.app/emote/{id}/2x.png"),
    sizes: std::collections::BTreeMap::default(),
    animated: false,
    overlaying: false,
    tags: Vec::new(),
    added: true,
  }
}

#[test]
fn bounds_policy_fields_and_preserves_queries_without_creating_ambiguous_tokens() -> Result<()> {
  let mut emotes = [
    example("x", "1"),
    example("A Wave", "2"),
    example("Other", "3"),
  ];
  emotes[0].image.push_str("?quality=high");
  emotes[1].sizes = [(1, "1x"), (2, "2x"), (4, "4x")]
    .map(|(scale, file)| (scale, format!("https://cdn.7tv.app/emote/2/{file}.png")))
    .into();
  let catalog = serde_json::to_value(browser_catalog(&emotes))?;
  assert_eq!(
    catalog.pointer("/0/image"),
    Some(&serde_json::json!("/7tv-cdn/emote/1/2x.png?quality=high"))
  );
  assert_eq!(catalog.pointer("/0/preview"), None);
  assert_eq!(
    catalog.pointer("/1/preview").and_then(Value::as_str),
    Some("/7tv-cdn/emote/2/4x.png")
  );
  assert_eq!(catalog.pointer("/2/preview"), None);
  assert_eq!(catalog.pointer("/0/composeToken"), None);
  assert_eq!(catalog.pointer("/1/composeToken"), None);
  assert_eq!(
    catalog.pointer("/2/sevenTVId"),
    Some(&serde_json::json!("3"))
  );
  Ok(())
}

#[test]
fn resolves_unique_partial_and_exact_names_and_maps_safe_cdn_paths() -> Result<()> {
  let mut unsafe_emote = example("Unsafe", "wrong");
  unsafe_emote.image = "https://invalid.example/unsafe.png".into();
  let emotes = vec![
    example("Wave", "1"),
    example("WaveLong", "2"),
    example("wave", "3"),
    unsafe_emote,
  ];
  assert_eq!(
    find_emote(&emotes, "wave").map(|e| e.id.as_str()),
    Some("1")
  );
  assert_eq!(
    find_emote(&emotes, "long").map(|e| e.id.as_str()),
    Some("2")
  );
  assert!(find_emote(&emotes, "wa").is_none());
  assert!(find_emote(&emotes, " ").is_none());
  assert!(find_emote(&emotes, "missing").is_none());
  let catalog = serde_json::to_value(browser_catalog(&emotes))?;
  assert_eq!(catalog.as_array().map(Vec::len), Some(3));
  assert_eq!(
    catalog.pointer("/0/image").and_then(Value::as_str),
    Some("/7tv-cdn/emote/1/2x.png")
  );
  assert_eq!(
    catalog.pointer("/0/composeToken").and_then(Value::as_str),
    Some("Wave")
  );
  assert_eq!(catalog.pointer("/2/composeToken"), None);
  assert_eq!(
    catalog.pointer("/2/sevenTVId").and_then(Value::as_str),
    Some("3")
  );
  for url in [
    "http://cdn.7tv.app/foo",
    "https://cdn.7tv.app:99/foo",
    "https://user:pass@cdn.7tv.app/foo",
    "https://cdn.7tv.app/foo#x",
    "https://cdn.7tv.app/",
    "not a URL",
  ] {
    assert!(cdn_url(url).is_none());
  }
  Ok(())
}

#[test]
fn checks_guild_policy_and_role_access() {
  let mut settings = GuildEmotes::default();
  assert!(settings.valid());
  assert!(!settings.allows_member_management(&[]));
  settings.allow_everyone = true;
  assert!(settings.allows_member_management(&[]));
  settings.allow_everyone = false;
  settings.allowed_roles.push("42".into());
  settings.seven_tv_set = Some("01234567890123456789012345".into());
  assert!(settings.valid());
  assert!(settings.allows_member_management(&["42".into()]));
  assert!(!settings.allows_member_management(&["43".into()]));
  settings.seven_tv_set = Some("invalid".into());
  assert!(!settings.valid());
  settings.seven_tv_set = None;
  settings.allowed_roles.push("invalid".into());
  assert!(!settings.valid());
  assert!(valid_seven_id("abcdefabcdefabcdefabcdef"));
  assert!(!valid_seven_id("zzzzzzzzzzzzzzzzzzzzzzzz"));
  assert!(!valid_seven_id("abc"));
}

#[test]
fn enforces_the_manager_role_limit_with_valid_role_ids() {
  let mut policy = GuildEmotes {
    allowed_roles: (1..=25).map(|role| role.to_string()).collect(),
    ..GuildEmotes::default()
  };
  assert!(policy.valid());
  policy.allowed_roles.push("26".into());
  assert!(!policy.valid());
}

#[test]
fn validates_url_authority_and_opaque_id_boundaries_before_catalog_precedence() -> Result<()> {
  for input in [
    "https://user@cdn.7tv.app/a",
    "https://:secret@cdn.7tv.app/a",
    "https://cdn.7tv.app/a#fragment",
    "https://cdn.7tv.app:8443/a",
    "https://cdn.7tv.app.evil.example/a",
    "https://cdn.7tv.app/",
  ] {
    assert!(cdn_url(input).is_none(), "accepted {input}");
  }
  assert!(cdn_url("https://cdn.7tv.app:443/a?quality=high").is_some());
  assert!(
    !GuildEmotes {
      seven_tv_set: Some("invalid".into()),
      ..GuildEmotes::default()
    }
    .valid()
  );

  let mut invalid = example("Wave", "bad");
  invalid.image = "https://untrusted.example/a".into();
  let valid = example("wave", "good");
  let rows = serde_json::to_value(browser_catalog(&[invalid, valid]))?;
  assert_eq!(
    rows.pointer("/0/composeToken").and_then(Value::as_str),
    Some("wave")
  );
  assert_eq!(rows.as_array().map(Vec::len), Some(1));
  Ok(())
}
