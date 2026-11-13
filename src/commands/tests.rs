//! Exercises command replies, autocomplete, and registration through local Discord and media fixtures.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]
#![allow(
  clippy::let_underscore_must_use,
  reason = "Fixture receivers may close during teardown, and tracing initialization is shared"
)]

use anyhow::Context as _;
use serde_json::{Value, json};
use serenity::all::Message;

use super::*;

/// Decodes fixture options from the same JSON shape used by Discord.
fn inputs(value: Value) -> Result<Vec<CommandDataOption>> {
  Ok(serde_json::from_value(value)?)
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
  for size in [-1, 0, 5, 65_536] {
    let options = inputs(json!([
      {"name":"emotes","type":3,"value":"Wave"},
      {"name":"size","type":4,"value":size}
    ]))?;
    assert!(
      matches!(commands.answer("emote-compose", &options, None, None).await?, Answer::Text(message) if message.contains("1 to 4"))
    );
  }
  let unknown = serde_json::from_value(json!({
    "id":"9", "application_id":"42", "type":2,
    "data":{"id":"7", "name":"unrelated", "type":1},
    "channel_id":"42", "token":"fixture", "version":1,
    "locale":"en-US", "entitlements":[], "attachment_size_limit":10_485_760,
    "user":crate::tests::user("3")
  }))?;
  commands
    .respond(&serenity::http::Http::new("unused"), unknown)
    .await?;
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
async fn sends_provider_variants_and_compositions_and_rejects_concurrent_rendering() -> Result<()> {
  use axum::{
    Json, Router,
    body::Bytes,
    http::StatusCode,
    routing::{get, patch, post},
  };
  let pixel = crate::tests::png_pixel()?;
  let (replies, mut sent) = tokio::sync::mpsc::unbounded_channel();
  let prefix_replies = replies.clone();
  let discovered_id = "01234567890123456789012345";
  let server = crate::tests::TestServer::start(
    Router::new()
      .route(
        "/api/v10/channels/2/messages",
        post(move |body: Bytes| async move {
          let _ = prefix_replies.send(body);
          Json(serenity::all::Message::default())
        }),
      )
      .route(
        "/api/v10/interactions/9/fixture/callback",
        post(|| async { StatusCode::NO_CONTENT }),
      )
      .route(
        "/api/v10/webhooks/42/fixture/messages/@original",
        patch(move |body: Bytes| async move {
          let _ = replies.send(body);
          Json(serenity::all::Message::default())
        }),
      )
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
  store.save_emote_border(guild, Some(0x00ff_7700))?;
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
  let explicit_scale =
    inputs(json!([{"name":"emotes","type":3,"value":"Wave"},{"name":"size","type":4,"value":2}]))?;
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
    matches!(commands.answer("emote-compose", &explicit_scale, Some(guild), None).await?, Answer::Image(image) if image.filename == "emote.png")
  );
  assert!(
    matches!(commands.answer("emote-compose", &compose, Some(guild), None).await?, Answer::Image(image) if image.filename == "emotes.png")
  );
  assert!(
    matches!(commands.answer("emote-compose", &name, Some(guild), Some(guild)).await?,
            Answer::Image(image) if crate::tests::png_dimensions(&image.bytes)? == (9, 9))
  );
  assert!(
    matches!(commands.answer("emote-compose", &compose, Some(guild), Some(guild)).await?,
            Answer::Image(image) if crate::tests::png_dimensions(&image.bytes)?.1 == 9)
  );
  let discovery =
    inputs(json!([{"name":"emotes","type":3,"value":format!("Wave 7tv:{discovered_id}")}]))?;
  assert!(matches!(
      commands.answer("emote-compose", &discovery, Some(guild), None).await?,
      Answer::Image(image) if crate::tests::png_dimensions(&image.bytes)? == (1, 1)
  ));
  // Exercise both Discord adapters with the same guild and a distinct user's saved border.
  store.save_emote_border(
    NonZeroU64::new(3).ok_or_else(|| anyhow::anyhow!("invalid fixture ID"))?,
    Some(0x0011_2233),
  )?;
  let mut user = serde_json::to_value(serenity::all::User::default())?;
  user
    .as_object_mut()
    .ok_or_else(|| anyhow::anyhow!("invalid fixture user"))?
    .extend([("id".into(), json!("3")), ("bot".into(), json!(false))]);
  let mut message = serde_json::to_value(Message::default())?;
  message
    .as_object_mut()
    .ok_or_else(|| anyhow::anyhow!("invalid fixture message"))?
    .extend([
      ("id".into(), json!("10")),
      ("channel_id".into(), json!("2")),
      ("guild_id".into(), json!("1")),
      ("author".into(), user.clone()),
      ("content".into(), json!("+Wave")),
    ]);
  let http = crate::tests::http_for(&server);
  commands
    .respond_message(&http, &serde_json::from_value(message)?)
    .await?;
  let mut interaction = json!({
    "id":"9", "application_id":"42", "guild_id":"1", "channel_id":"2",
    "token":"fixture", "version":1, "locale":"en-US", "entitlements":[],
    "attachment_size_limit":10_485_760, "user":user,
    "data":{"id":"7", "type":1, "name":"emote-compose", "options":[
      {"name":"emotes", "type":3, "value":"Wave"}
    ]}
  });
  commands
    .respond(&http, serde_json::from_value(interaction.clone())?)
    .await?;
  for _ in 0..2 {
    let body = sent.try_recv()?;
    let png = body
      .windows(8)
      .position(|bytes| bytes == b"\x89PNG\r\n\x1a\n")
      .ok_or_else(|| anyhow::anyhow!("missing bordered attachment"))?;
    assert_eq!(
      crate::tests::png_dimensions(body.get(png..).context("missing PNG data")?)?,
      (9, 9)
    );
  }
  *interaction
    .get_mut("attachment_size_limit")
    .context("missing fixture upload limit")? = json!(1);
  commands
    .respond(&http, serde_json::from_value(interaction)?)
    .await?;
  let body = sent.try_recv()?;
  assert!(String::from_utf8_lossy(&body).contains("exceeds Discord's upload limit"));
  assert!(!body.windows(8).any(|bytes| bytes == b"\x89PNG\r\n\x1a\n"));
  assert_eq!(store.added_emotes(guild)?.len(), 1);
  Ok(())
}
