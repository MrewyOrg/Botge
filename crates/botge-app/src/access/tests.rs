//! Bounds capability deadlines and keeps credentials out of diagnostics.
#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe fixture failures"
)]
use std::assert_matches;

use super::*;

struct Pending;
impl GuildAccess for Pending {
  fn exchange_code(
    &self,
    _code: &str,
  ) -> impl Future<Output = Result<AccessToken, AccessError>> + Send {
    std::future::pending()
  }
  fn user_id(
    &self,
    _credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, AccessError>> + Send {
    std::future::pending()
  }
  fn membership(
    &self,
    _guild: NonZeroU64,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Membership, AccessError>> + Send {
    std::future::pending()
  }
  fn voice_channels(
    &self,
    _guild: NonZeroU64,
    _credential: &Credential,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, AccessError>> + Send {
    std::future::pending()
  }
}

#[tokio::test(start_paused = true)]
async fn times_out_capabilities_without_polling_them_forever() {
  let credential = Credential::new("never-print-this-token".into());
  assert!(!format!("{credential:?}").contains("never-print"));
  let token = AccessToken {
    access_token: "never-print-this-token".into(),
    expires_in: 3600,
  };
  assert!(!format!("{token:?}").contains("never-print"));
  assert_matches!(
    membership(&Pending, NonZeroU64::MIN, &credential).await,
    Err(AccessError(FailureKind::Upstream, _))
  );
  assert_matches!(
    channels(&Pending, NonZeroU64::MIN, &credential).await,
    Err(AccessError(FailureKind::Upstream, _))
  );
  assert_matches!(
    user_id(&Pending, &credential).await,
    Err(AccessError(FailureKind::Upstream, _))
  );
}

#[test]
fn access_errors_compose_with_standard_error_consumers_without_disclosing_causes() {
  let error = AccessError::UNAUTHORIZED;
  assert_eq!(error.to_string(), error.1);
  let message = error.1;
  let wrapped = anyhow::Error::new(error);
  assert!(wrapped.is::<AccessError>());
  assert_eq!(wrapped.to_string(), message);
}
