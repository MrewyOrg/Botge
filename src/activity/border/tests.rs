//! Exercises signed border requests through the complete Activity router.

#![allow(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Test failures are expressed through returned fixture errors and assertion panics"
)]

use axum::http::StatusCode;
use serde_json::json;
use std::num::NonZeroU64;

use super::super::tests::Fixture;

#[tokio::test]
async fn stores_an_optional_border_for_the_authenticated_user() -> anyhow::Result<()> {
  let fixture = Fixture::new()?;
  let read = json!({"guildId":"1","code":"member"});
  let save = |code: &str, color: &str| json!({"guildId":"1","code":code,"color":color});
  assert_eq!(
    fixture.post("/settings/border/read", &read, true).await?,
    (StatusCode::OK, json!({"color":""}))
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", "#ff7700"), false)
      .await?
      .0,
    StatusCode::UNAUTHORIZED
  );
  assert_eq!(
    fixture
      .post("/settings/border", &save("bad", "#ff7700"), true)
      .await?
      .0,
    StatusCode::UNAUTHORIZED
  );
  for invalid in ["red", "GG0000"] {
    assert_eq!(
      fixture
        .post("/settings/border", &save("member", invalid), true)
        .await?
        .0,
      StatusCode::BAD_REQUEST
    );
  }
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", "#ff7700"), true)
      .await?,
    (StatusCode::OK, json!({"color":"FF7700"}))
  );
  assert_eq!(
    fixture.post("/settings/border/read", &read, true).await?.1,
    json!({"color":"FF7700"})
  );
  assert_eq!(fixture.store.emote_border(NonZeroU64::MIN)?, None);
  assert_eq!(
    fixture
      .post("/settings/border", &save("member", ""), true)
      .await?
      .1,
    json!({"color":""})
  );
  assert_eq!(fixture.store.emote_border(NonZeroU64::MAX)?, None);
  Ok(())
}
