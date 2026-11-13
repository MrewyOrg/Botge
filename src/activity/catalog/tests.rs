//! Exercises signed catalog requests through the complete Activity router.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use axum::{Json, Router, http::StatusCode, routing::get};
use serde_json::{Value, json};
use std::{
  num::NonZeroU64,
  sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
  },
};

use super::super::tests::Fixture;

#[tokio::test]
async fn rejects_id_conflicts_and_concurrent_additions_after_a_stale_catalog_read()
-> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let emote = crate::emotes::tests::example("Wave", "01234567890123456789012345");
  assert!(fixture.store.add_emote(NonZeroU64::MIN, emote.clone())?);
  let state = fixture.state()?;
  let error = state
    .add_to_catalog(NonZeroU64::MIN, emote.clone(), &[])
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("stale insertion was accepted"))?;
  assert_eq!(error.0, StatusCode::CONFLICT);
  let mut renamed = emote.clone();
  renamed.name = "Renamed".into();
  let error = state
    .add_to_catalog(NonZeroU64::MIN, renamed, &[emote])
    .await
    .err()
    .ok_or_else(|| anyhow::anyhow!("duplicate ID was accepted"))?;
  assert_eq!(error.0, StatusCode::CONFLICT);
  assert_eq!(fixture.store.added_emotes(NonZeroU64::MIN)?.len(), 1);
  Ok(())
}

#[tokio::test]
async fn rejects_invalid_removals_and_reports_incompatible_storage() -> anyhow::Result<()> {
  let upstream = crate::tests::TestServer::start(Router::new()).await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let request = json!({"guildId":"1","code":"admin","emoteId":"bad"});
  assert_eq!(
    fixture.post("/emotes/remove", &request, true).await?.0,
    StatusCode::BAD_REQUEST
  );
  for table in ["guild_emotes", "added_emotes"] {
    let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
    fixture.store.invalidate_table(table)?;
    let request = json!({"guildId":"1","code":"admin"});
    assert_eq!(
      fixture.post("/catalog", &request, true).await?.0,
      StatusCode::INTERNAL_SERVER_ERROR
    );
    if table == "guild_emotes" {
      assert_eq!(
        fixture
          .post("/settings/emotes/read", &request, true)
          .await?
          .0,
        StatusCode::INTERNAL_SERVER_ERROR
      );
    }
  }
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::too_many_lines,
  reason = "Keep the sequential fixture setup, actions, and assertions in one scenario"
)]
#[expect(
  clippy::literal_string_with_formatting_args,
  reason = "Braces identify Axum route captures, not Rust formatting arguments"
)]
async fn serves_a_guild_catalog_and_allows_only_authorized_adds_and_removals() -> anyhow::Result<()>
{
  let id = "01234567890123456789012345";
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get(
      move |axum::extract::Path(requested): axum::extract::Path<String>| async move {
        if requested != id {
          return Err(StatusCode::NOT_FOUND);
        }
        Ok(Json(
          json!({"id":id,"name":"Wave","animated":false,"flags":0,"listed":true,
                "host":{"files":[{"name":"2x.png"}]}}),
        ))
      },
    ),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let admin = json!({"guildId":"1","code":"admin","emoteId":id});
  let member = json!({"guildId":"1","code":"member","emoteId":id});
  assert_eq!(
    fixture.post("/emotes", &member, true).await?.0,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    fixture
      .post(
        "/emotes",
        &json!({"guildId":"1","code":"admin","emoteId":"bad"}),
        true
      )
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );
  assert_eq!(
    fixture
      .post(
        "/emotes",
        &json!({"guildId":"1","code":"admin","emoteId":"000000000000000000000000"}),
        true
      )
      .await?
      .0,
    StatusCode::NOT_FOUND
  );
  assert_eq!(
    fixture.post("/emotes", &admin, true).await?.0,
    StatusCode::CREATED
  );
  assert_eq!(
    fixture.post("/emotes", &admin, true).await?.0,
    StatusCode::CONFLICT
  );
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"member"}), true)
    .await?;
  assert_eq!(
    catalog
      .pointer("/emotes/0/sevenTVId")
      .and_then(Value::as_str),
    Some(id)
  );
  assert_eq!(catalog.get("canManageEmotes"), Some(&Value::Bool(false)));
  let (_, other) = fixture
    .post("/catalog", &json!({"guildId":"2","code":"admin"}), true)
    .await?;
  assert_eq!(other.get("emotes"), Some(&json!([])));
  assert_eq!(
    fixture.post("/emotes/remove", &member, true).await?.0,
    StatusCode::FORBIDDEN
  );

  let access = json!({"allowEveryone":true});
  let save = json!({"guildId":"1","code":"admin","emotes": access});
  assert_eq!(
    fixture.post("/settings/emotes", &save, true).await?.0,
    StatusCode::OK
  );
  let (status, settings) = fixture
    .post(
      "/settings/emotes/read",
      &json!({"guildId":"1","code":"admin"}),
      true,
    )
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(settings.get("allowEveryone"), Some(&Value::Bool(true)));
  assert_eq!(
    fixture
      .post(
        "/settings/emotes/read",
        &json!({"guildId":"1","code":"member"}),
        true
      )
      .await?
      .0,
    StatusCode::FORBIDDEN
  );
  assert_eq!(
    fixture
      .post(
        "/settings/emotes",
        &json!({"guildId":"1","code":"admin","emotes":{"ffzChannel":"x/y"}}),
        true
      )
      .await?
      .0,
    StatusCode::BAD_REQUEST
  );

  let (status, body) = fixture.post("/emotes/remove", &member, true).await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body.get("removed"), Some(&Value::Bool(true)));
  assert_eq!(
    fixture.post("/emotes/remove", &member, true).await?.0,
    StatusCode::NOT_FOUND
  );

  let disabled = Fixture::new()?;
  assert_eq!(
    disabled.post("/emotes", &admin, true).await?.0,
    StatusCode::FORBIDDEN
  );
  Ok(())
}

#[tokio::test]
#[expect(
  clippy::literal_string_with_formatting_args,
  reason = "Braces identify Axum route captures, not Rust formatting arguments"
)]
async fn retries_a_failed_emote_add_without_leaving_a_record() -> anyhow::Result<()> {
  let id = "01234567890123456789012345";
  let available = Arc::new(AtomicBool::new(false));
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get({
      let available = Arc::clone(&available);
      move || async move {
        if !available.load(Ordering::Relaxed) {
          return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
        Ok(Json(json!({
            "id":id,"name":"Wave","animated":false,"flags":0,"listed":true,
            "host":{"files":[{"name":"2x.png"}]}
        })))
      }
    }),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let add = json!({"guildId":"1","code":"admin","emoteId":id});

  assert_eq!(
    fixture.post("/emotes", &add, true).await?.0,
    StatusCode::BAD_GATEWAY
  );
  let added = fixture.store.added_emotes(NonZeroU64::MIN)?;
  assert!(added.is_empty(), "unexpected added emotes: {added:?}");
  available.store(true, Ordering::Relaxed);
  assert_eq!(
    fixture.post("/emotes", &add, true).await?.0,
    StatusCode::CREATED
  );
  assert_eq!(
    fixture
      .store
      .added_emotes(NonZeroU64::MIN)?
      .first()
      .map(|emote| emote.id.as_str()),
    Some(id)
  );
  Ok(())
}

#[tokio::test]
async fn a_delegated_emote_manager_can_remove_emotes_but_cannot_change_settings()
-> anyhow::Result<()> {
  let upstream = crate::tests::TestServer::start(Router::new()).await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let id = "01234567890123456789012345";
  assert!(
    fixture
      .store
      .add_emote(NonZeroU64::MIN, crate::emotes::tests::example("Wave", id))?
  );

  let remove = json!({"guildId":"1","code":"manager","emoteId":id});
  assert_eq!(
    fixture.post("/emotes/remove", &remove, true).await?.0,
    StatusCode::FORBIDDEN
  );

  let grant_role = json!({"guildId":"1","code":"admin","emotes":{"allowedRoles":["42"]}});
  assert_eq!(
    fixture.post("/settings/emotes", &grant_role, true).await?.0,
    StatusCode::OK
  );
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"manager"}), true)
    .await?;
  assert_eq!(catalog.get("canManageEmotes"), Some(&Value::Bool(true)));
  let expand_access = json!({"guildId":"1","code":"manager","emotes":{"allowEveryone":true}});
  assert_eq!(
    fixture
      .post("/settings/emotes", &expand_access, true)
      .await?
      .0,
    StatusCode::FORBIDDEN
  );

  assert_eq!(
    fixture.post("/emotes/remove", &remove, true).await?.0,
    StatusCode::OK
  );
  let added = fixture.store.added_emotes(NonZeroU64::MIN)?;
  assert!(added.is_empty(), "unexpected added emotes: {added:?}");
  Ok(())
}

#[tokio::test]
async fn changes_a_batch_with_one_authorization_and_reports_partial_results() -> anyhow::Result<()>
{
  let first = "01234567890123456789012345";
  let second = "01234567890123456789012346";
  let missing = "01234567890123456789012347";
  let upstream = crate::tests::TestServer::start(Router::new().route(
    "/v3/emotes/{id}",
    get(
      move |axum::extract::Path(id): axum::extract::Path<String>| async move {
        let name = match id.as_str() {
          value if value == first => "First",
          value if value == second => "Second",
          _ => return Err(StatusCode::NOT_FOUND),
        };
        Ok(Json(
          json!({"id":id,"name":name,"animated":false,"flags":256,"listed":true,
                "tags":["Test"],"host":{"files":[{"name":"2x.png"}]}}),
        ))
      },
    ),
  ))
  .await?;
  let fixture = Fixture::with_emotes(Some(upstream.origin.clone()))?;
  let request = |code: &str, action: &str, ids: &[&str]| json!({"guildId":"1","code":code,"action":action,"emoteIds":ids});
  assert_eq!(
    fixture
      .post("/emotes/batch", &request("member", "add", &[first]), true)
      .await?
      .0,
    StatusCode::FORBIDDEN
  );
  for invalid in [&[][..], &[first, first], &["bad-id"], &[first; 13]] {
    assert_eq!(
      fixture
        .post("/emotes/batch", &request("admin", "add", invalid), true)
        .await?
        .0,
      StatusCode::BAD_REQUEST
    );
  }
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 1);
  let added = fixture.store.added_emotes(NonZeroU64::MIN)?;
  assert!(added.is_empty(), "unexpected added emotes: {added:?}");
  let (status, added) = fixture
    .post(
      "/emotes/batch",
      &request("admin", "add", &[first, missing, second]),
      true,
    )
    .await?;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(fixture.membership_calls.load(Ordering::Relaxed), 2);
  assert_eq!(added.pointer("/0/emoteId"), Some(&json!(first)));
  assert_eq!(added.pointer("/1/emoteId"), Some(&json!(missing)));
  assert_eq!(added.pointer("/2/emoteId"), Some(&json!(second)));
  assert_eq!(added.pointer("/0/ok"), Some(&json!(true)));
  assert_eq!(added.pointer("/1/ok"), Some(&json!(false)));
  assert_eq!(added.pointer("/2/ok"), Some(&json!(true)));
  let (_, catalog) = fixture
    .post("/catalog", &json!({"guildId":"1","code":"admin"}), true)
    .await?;
  assert_eq!(catalog.pointer("/canComposeDiscovery"), Some(&json!(true)));
  assert_eq!(catalog.pointer("/emotes/0/overlaying"), Some(&json!(true)));
  assert_eq!(catalog.pointer("/emotes/0/tags/0"), Some(&json!("Test")));
  let (_, settings) = fixture
    .post(
      "/settings/emotes/read",
      &json!({"guildId":"1","code":"admin"}),
      true,
    )
    .await?;
  assert_eq!(
    settings.pointer("/roles/0/name"),
    Some(&json!("Emote manager"))
  );
  let membership_calls = fixture.membership_calls.load(Ordering::Relaxed);
  let (_, removed) = fixture
    .post(
      "/emotes/batch",
      &request("admin", "remove", &[first, second, missing]),
      true,
    )
    .await?;
  assert_eq!(
    fixture.membership_calls.load(Ordering::Relaxed),
    membership_calls + 1
  );
  assert_eq!(removed.pointer("/0/ok"), Some(&json!(true)));
  assert_eq!(removed.pointer("/1/ok"), Some(&json!(true)));
  assert_eq!(removed.pointer("/2/ok"), Some(&json!(false)));
  let added = fixture.store.added_emotes(NonZeroU64::MIN)?;
  assert!(added.is_empty(), "unexpected added emotes: {added:?}");
  Ok(())
}
