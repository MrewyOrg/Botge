use serde_json::Value;

use super::*;

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
  assert!(disabled.catalog(Some(guild)).await?.is_empty());
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
  assert!(enabled.catalog(None).await?.is_empty());
  assert!(enabled.fetch_added("invalid").await?.is_none());
  Ok(())
}
