use super::*;
use crate::tests::TestServer;

#[tokio::test]
async fn separates_gateway_readiness_from_liveness_and_recovers() -> anyhow::Result<()> {
  let (sender, receiver) = watch::channel(false);
  let server = TestServer::start(router(receiver)).await?;
  let live = server.origin.join("healthz")?;
  let ready = server.origin.join("readyz")?;
  check(live.as_str()).await?;
  assert!(check(ready.as_str()).await.is_err());
  sender.send_replace(true);
  check(ready.as_str()).await?;
  sender.send_replace(false);
  assert!(check(ready.as_str()).await.is_err());
  check(live.as_str()).await?;
  assert!(check("http://127.0.0.1:0/readyz").await.is_err());
  Ok(())
}
