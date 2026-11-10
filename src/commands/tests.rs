//! Exercises command replies, autocomplete, and registration through local Discord and media fixtures.

use super::*;
use serde_json::{Value, json};

/// Decodes fixture options from the same JSON shape used by Discord.
fn inputs(value: Value) -> Result<Vec<CommandDataOption>> {
  Ok(serde_json::from_value(value)?)
}

#[test]
fn exposes_only_the_ported_commands() -> Result<()> {
  let commands = serde_json::to_value(definitions())?;
  for (index, expected) in NAMES.into_iter().enumerate() {
    assert_eq!(
      commands
        .pointer(&format!("/{index}/name"))
        .and_then(Value::as_str),
      Some(expected)
    );
  }
  assert_eq!(commands.as_array().map(Vec::len), Some(3));
  assert_eq!(commands.pointer("/2/integration_types"), Some(&json!([0])));
  assert_eq!(commands.pointer("/2/contexts"), Some(&json!([0])));
  assert_eq!(
    commands.pointer("/2/default_member_permissions"),
    Some(&json!("8"))
  );
  assert_eq!(
    commands.pointer("/0/options/0/required"),
    Some(&Value::Bool(true))
  );
  Ok(())
}

#[test]
fn suggests_unique_names_ranked_by_match_and_keeps_existing_tokens() {
  let entries = ["SeaWave", "Waves", "Wave", "wave", "A Wave", "Hey"]
    .map(|name| crate::emotes::tests::example(name, name));
  assert_eq!(
    suggestions(&entries, "wAvE"),
    ["Wave", "Waves", "SeaWave", "A Wave"]
  );
  assert_eq!(
    suggestions(&entries, "Hey wavE"),
    ["Hey Wave", "Hey Waves", "Hey SeaWave"]
  );
  assert!(suggestions(&entries, "other").is_empty());
  assert!(suggestions(&entries, &format!("{} ", "x".repeat(100))).is_empty());
  assert!(shortcuts(&entries, "Waves").contains("`Waves` → `es`"));
  assert!(shortcuts(&entries, "A Wave").starts_with("`A Wave`"));
  assert!(shortcuts(&entries, "other").starts_with("No unique"));
}

#[tokio::test]
async fn returns_friendly_errors_for_missing_and_ambiguous_input() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let emotes = Arc::new(Emotes::new(
    crate::config::Providers::default(),
    store,
    None,
  )?);
  let commands = Commands::new(emotes, None);
  assert!(
    matches!(commands.answer("emote-compose", &[], None, None).await?, Answer::Text(message) if message.contains("Enter emote"))
  );
  let options = inputs(json!([{"name":"emotes","type":3,"value":"missing"}]))?;
  assert!(
    matches!(commands.answer("emote-compose", &options, None, None).await?, Answer::Text(message) if message.contains("missing"))
  );
  let options = inputs(json!([{"name":"emotes","type":3,"value":"x ".repeat(33)}]))?;
  assert!(
    matches!(commands.answer("emote-compose", &options, None, None).await?, Answer::Text(message) if message.contains("1 and 32"))
  );
  assert!(
    matches!(commands.answer("emote-shortcuts", &[], None, None).await?, Answer::Text(message) if message.contains("No unique"))
  );
  assert!(
    matches!(commands.answer("unknown", &[], None, None).await?, Answer::Text(message) if message.contains("unavailable"))
  );
  Ok(())
}

#[tokio::test]
async fn sends_original_and_resized_images_and_rejects_concurrent_rendering() -> Result<()> {
  use axum::{Json, Router, routing::get};
  use base64::{Engine as _, engine::general_purpose::STANDARD};
  let pixel = STANDARD.decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XioAAAAASUVORK5CYII=",
  )?;
  let discovered_id = "01234567890123456789012345";
  let server = crate::tests::TestServer::start(
    Router::new()
      .route("/7tv/emote/{id}/2x.png", get(move || async move { pixel }))
      .route(
        "/v3/emotes/{id}",
        get(move || async move {
          Json(
            json!({"id":discovered_id,"name":"Discovery","animated":false,"flags":256,
                    "listed":true,"host":{"files":[{"name":"2x.png"}]}}),
          )
        }),
      ),
  )
  .await?;
  let directory = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(
    &directory.path().join("botge.redb"),
  )?);
  let guild = NonZeroU64::MIN;
  store.add_emote(guild, crate::emotes::tests::example("Wave", "1"))?;
  store.save_emote_border(guild, Some(0xff7700))?;
  let mut emotes = Emotes::new(
    crate::config::Providers {
      seven_added: true,
      ..Default::default()
    },
    Arc::clone(&store),
    None,
  )?;
  emotes.use_provider_fixture(server.origin.clone());
  let commands = Commands::new(Arc::new(emotes), Some(server.origin.clone()));
  let name = inputs(json!([{"name":"emotes","type":3,"value":"Wave"}]))?;
  let size =
    inputs(json!([{"name":"emotes","type":3,"value":"Wave"},{"name":"size","type":4,"value":64}]))?;
  let compose = inputs(
    json!([{"name":"emotes","type":3,"value":"Wave Wave"},{"name":"fullsize","type":5,"value":true},{"name":"stretch","type":5,"value":false}]),
  )?;
  // Hold the permit directly to make the busy checks independent of render timing.
  let busy = commands.render_slot.acquire().await?;
  assert!(
    matches!(commands.answer("emote-compose", &name, Some(guild), None).await?, Answer::Text(message) if message.contains("rendering"))
  );
  assert!(
    matches!(commands.answer("emote-compose", &compose, Some(guild), None).await?, Answer::Text(message) if message.contains("rendering"))
  );
  drop(busy);
  assert!(
    matches!(commands.answer("emote-compose", &name, Some(guild), None).await?, Answer::Image(image) if image.filename == "emote.png")
  );
  assert!(
    matches!(commands.answer("emote-compose", &size, Some(guild), None).await?, Answer::Image(image) if image.filename == "emotes.png")
  );
  assert!(
    matches!(commands.answer("emote-compose", &compose, Some(guild), None).await?, Answer::Image(image) if image.filename == "emotes.png")
  );
  assert!(
    matches!(commands.answer("emote-compose", &name, Some(guild), Some(guild)).await?,
            Answer::Image(image) if image.bytes.get(16..24) == Some([0, 0, 0, 9, 0, 0, 0, 9].as_slice()))
  );
  assert!(
    matches!(commands.answer("emote-compose", &compose, Some(guild), Some(guild)).await?,
            Answer::Image(image) if image.bytes.get(20..24) == Some([0, 0, 1, 8].as_slice()))
  );
  let discovery =
    inputs(json!([{"name":"emotes","type":3,"value":format!("Wave 7tv:{discovered_id}")}]))?;
  assert!(matches!(
      commands.answer("emote-compose", &discovery, Some(guild), None).await?,
      Answer::Image(image) if image.bytes.get(16..24) == Some([0, 0, 0, 64, 0, 0, 0, 64].as_slice())
  ));
  assert_eq!(store.added_emotes(guild)?.len(), 1);
  Ok(())
}

#[tokio::test]
async fn registers_emote_commands_and_removes_retired_commands_while_preserving_launch()
-> Result<()> {
  use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    routing::{delete, get},
  };
  use tokio::sync::mpsc;
  let (deleted, mut removals) = mpsc::unbounded_channel();
  let command = |id: &str, name: &str, kind: u8| {
    json!({
        "id":id,"application_id":"42","type":kind,"name":name,"description":"Fixture","version":"1"
    })
  };
  let legacy = json!([
    command("11", "settings", 1),
    command("12", "launch", 4),
    command("13", "emote", 1),
    command("14", "emote-search", 1)
  ]);
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/api/v10/applications/42/commands",
        get(move || async move { Json(legacy) }).post(|Json(body): Json<Value>| async move {
          Json(json!({
              "id":"14","application_id":"42","type":1,
              "name":body.get("name"),"description":"Fixture","version":"1"
          }))
        }),
      )
      .route(
        "/api/v10/applications/42/commands/{id}",
        delete(move |Path(id): Path<String>| async move {
          let _ = deleted.send(id);
          StatusCode::NO_CONTENT
        }),
      ),
  )
  .await?;
  register(&crate::tests::http_for(&server)).await?;
  assert_eq!(removals.try_recv()?.as_str(), "11");
  assert_eq!(removals.try_recv()?.as_str(), "13");
  assert_eq!(removals.try_recv()?.as_str(), "14");
  assert!(removals.try_recv().is_err());
  Ok(())
}

#[tokio::test]
async fn sends_name_and_size_choices_to_discord() -> Result<()> {
  use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
  };
  use tokio::sync::mpsc;

  let dir = tempfile::tempdir()?;
  let store = Arc::new(crate::storage::Store::open(&dir.path().join("botge.redb"))?);
  store.add_emote(NonZeroU64::MIN, crate::emotes::tests::example("Wave", "1"))?;
  let mut emotes = Emotes::new(
    crate::config::Providers {
      seven_added: true,
      bttv: true,
      ..Default::default()
    },
    store,
    None,
  )?;
  let (sender, mut choices) = mpsc::unbounded_channel();
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/api/v10/interactions/9/fixture/callback",
        post(move |Json(body): Json<Value>| async move {
          let _ = sender.send(body);
          StatusCode::NO_CONTENT
        }),
      )
      .route(
        "/3/cached/emotes/global",
        get(|| async { Json(json!([{"id":"valid","code":"GlobalWave","animated":false}])) }),
      ),
  )
  .await?;
  emotes.use_provider_fixture(server.origin.clone());
  let commands = Commands::new(Arc::new(emotes), None);
  let http = crate::tests::http_for(&server);
  for (name, field, kind, value, expected) in [
    ("emote-compose", "emotes", 3, "Wa", json!("Wave")),
    ("emote-compose", "size", 4, "64", json!(64)),
    (
      "emote-compose",
      "emotes",
      3,
      "First Wa",
      json!("First Wave"),
    ),
    ("emote-shortcuts", "emotes", 3, "Wa", json!("Wave")),
    (
      "emote-shortcuts",
      "emotes",
      3,
      "Global",
      json!("GlobalWave"),
    ),
    ("emote-compose", "emotes", 3, "Global", json!("GlobalWave")),
  ] {
    let interaction = serde_json::from_value(json!({
        "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
        "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
        "attachment_size_limit":10485760,
        "data":{"id":"7","type":1,"name":name,"options":[
            {"name":field,"type":kind,"value":value,"focused":true}
        ]}
    }))?;
    commands.autocomplete(&http, interaction).await?;
    let response = choices.try_recv()?;
    assert_eq!(response.get("type"), Some(&json!(8)));
    assert_eq!(response.pointer("/data/choices/0/value"), Some(&expected));
  }
  Ok(())
}

#[test]
fn accepts_the_plus_prefix_only_when_attached_to_a_token() {
  assert_eq!(prefix_input("+Wave Hat"), Some("Wave Hat"));
  assert_eq!(prefix_input("+<:Wave:42>"), Some("<:Wave:42>"));
  for ignored in ["+", "+ Wave", "+\tWave", "++Wave", "a +Wave", "Wave"] {
    assert_eq!(prefix_input(ignored), None);
  }
}

#[test]
fn parses_pixel_sizes_without_changing_emote_ids_or_image_urls() {
  let id = "7tv:123456789012345678901234";
  let url = "https://cdn.discordapp.com/attachments/1/2/emote.png?signature=foo:96";
  for input in ["Wave Hat", "Wave:96 Hat", "<:Wave:42>", id, url] {
    assert_eq!(prefix_size(input), Ok((input, None)));
  }
  for (input, names, size) in [
    ("Wave Hat:96  ", "Wave Hat", 96),
    ("Wave:24", "Wave", 24),
    ("<:Wave:42>:256", "<:Wave:42>", 256),
    ("7tv:123456789012345678901234:64", id, 64),
    (&format!("{url} :96"), url, 96),
  ] {
    assert_eq!(prefix_size(input), Ok((names, Some(size))));
  }
  for input in ["Wave:0", "Wave:257", "Wave:65536"] {
    assert!(prefix_size(input).is_err());
  }
}
