//! Checks catalog precedence, browser mappings, and operator-controlled provider access.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use serde_json::Value;

use super::*;

pub(crate) use super::providers::tests::{SEVEN_ID, seven_example};

#[test]
fn bounds_policy_fields_and_preserves_queries_without_creating_ambiguous_tokens() -> Result<()> {
  for id in ["", "123456789012345678901", "not-digits"] {
    assert!(
      !GuildEmotes {
        bttv_twitch_id: Some(id.into()),
        ..GuildEmotes::default()
      }
      .valid()
    );
  }
  for name in [String::new(), "x".repeat(26)] {
    assert!(
      !GuildEmotes {
        ffz_channel: Some(name),
        ..GuildEmotes::default()
      }
      .valid()
    );
  }
  assert!(
    !GuildEmotes {
      allowed_roles: vec!["42".into(); 26],
      ..GuildEmotes::default()
    }
    .valid()
  );
  assert!(!valid_seven_id("0123456789012345678901234/"));
  assert!(!valid_seven_id("01234567890123456789012345/"));
  assert!(cdn_url("https://:secret@cdn.7tv.app/image.png", Source::SevenTv).is_none());
  let mut emotes = [
    example("x", "1"),
    example("A Wave", "2"),
    example("Other", "3"),
  ];
  emotes[0].image.push_str("?quality=high");
  emotes[2].source = Source::BetterTtv;
  emotes[2].image = "https://cdn.betterttv.net/emote/3/2x.png".into();
  let catalog = serde_json::to_value(browser_catalog(&emotes))?;
  assert_eq!(
    catalog.pointer("/0/image"),
    Some(&serde_json::json!("/7tv-cdn/emote/1/2x.png?quality=high"))
  );
  assert_eq!(catalog.pointer("/0/composeToken"), None);
  assert_eq!(catalog.pointer("/1/composeToken"), None);
  assert_eq!(catalog.pointer("/2/sevenTVId"), None);
  Ok(())
}

impl Emotes {
  /// Redirects provider requests to a local fixture while the client is still uniquely owned.
  pub(crate) fn use_provider_fixture(&mut self, origin: Url) {
    if let Some(client) = Arc::get_mut(&mut self.client) {
      client.test_origin = Some(origin);
    }
  }
}

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
    assert!(cdn_url(url, Source::SevenTv).is_none());
  }
  Ok(())
}

#[test]
fn checks_guild_policy_and_role_access() {
  let mut settings = GuildEmotes::default();
  assert!(settings.valid());
  assert!(settings.can_manage(true, &[]));
  assert!(!settings.can_manage(false, &[]));
  settings.allow_everyone = true;
  assert!(settings.can_manage(false, &[]));
  settings.allow_everyone = false;
  settings.allowed_roles.push("42".into());
  settings.ffz_channel = Some("streamer_1".into());
  settings.seven_tv_set = Some("01234567890123456789012345".into());
  settings.bttv_twitch_id = Some("42".into());
  assert!(settings.valid());
  assert!(settings.can_manage(false, &["42".into()]));
  assert!(!settings.can_manage(false, &["43".into()]));
  settings.ffz_channel = Some("evil/path".into());
  assert!(!settings.valid());
  settings.ffz_channel = None;
  settings.bttv_twitch_id = Some("evil".into());
  assert!(!settings.valid());
  settings.bttv_twitch_id = None;
  settings.allowed_roles.push("invalid".into());
  assert!(!settings.valid());
  assert!(valid_seven_id("abcdefabcdefabcdefabcdef"));
  assert!(!valid_seven_id("zzzzzzzzzzzzzzzzzzzzzzzz"));
  assert!(!valid_seven_id("abc"));
}

#[tokio::test]
async fn disabled_provider_blocks_added_emotes_and_catalog_is_empty() -> Result<()> {
  let dir = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&dir.path().join("botge.redb"))?);
  let guild = NonZeroU64::MIN;
  assert!(store.add_emote(guild, example("Stored", "1"))?);
  let disabled = Emotes::new(Providers::default(), Arc::clone(&store), None)?;
  let catalog = disabled.catalog(Some(guild)).await?;
  assert!(catalog.is_empty(), "unexpected catalog emotes: {catalog:?}");
  assert!(
    disabled
      .fetch_added("01234567890123456789012345")
      .await?
      .is_none()
  );
  let enabled = Emotes::new(
    Providers {
      seven_added: true,
      ..Providers::default()
    },
    store,
    None,
  )?;
  assert_eq!(enabled.catalog(Some(guild)).await?.len(), 1);
  let catalog = enabled.catalog(None).await?;
  assert!(catalog.is_empty(), "unexpected catalog emotes: {catalog:?}");
  assert!(enabled.fetch_added("invalid").await?.is_none());
  Ok(())
}
