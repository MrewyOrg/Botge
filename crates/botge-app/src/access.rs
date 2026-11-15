//! Discord identity and authorization capability contracts shared by adapters.
use serde::Serialize;
use std::num::NonZeroU64;

/// A voice channel the Activity can offer as a join target.
#[derive(Debug, Serialize)]
pub struct VoiceChannel {
  /// Canonical Discord identifier.
  pub id: String,
  /// Discord display label.
  pub name: String,
}

/// A guild role ID and label for the emote manager picker.
#[derive(Debug, Serialize)]
pub struct GuildRole {
  /// Canonical Discord identifier.
  pub id: String,
  /// Discord display label.
  pub name: String,
}

/// The caller's guild membership and the roles offered in the settings picker.
#[derive(Debug)]
pub struct Membership {
  /// Whether the caller administers the guild.
  pub administrator: bool,
  /// Role IDs granted to the caller.
  pub roles: Vec<String>,
  /// Selectable guild roles. This is empty for callers without administrator access.
  pub available_roles: Vec<GuildRole>,
}

/// A one-use authorization code or an access token obtained from that code.
/// Neither credential is logged or persisted by the API.
pub enum Credential {
  /// A short-lived, single-use authorization code.
  Code(String),
  /// A browser-held access token.
  AccessToken(String),
}

/// Short-lived browser authentication returned by the code-exchange endpoint.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessToken {
  /// Short-lived bearer credential; never persisted.
  pub access_token: String,
  /// Credential lifetime in seconds.
  pub expires_in: u64,
}

/// Resolves Discord identity and guild access from validated Activity credentials.
pub trait GuildAccess: Send + Sync + 'static {
  /// Exchanges a one-use Discord authorization code for a browser-held access token.
  ///
  /// # Errors
  ///
  /// Returns a client-safe API error when the code is expired or rejected, client credentials
  /// are invalid, or Discord cannot complete the exchange.
  fn exchange_code(
    &self,
    code: &str,
  ) -> impl Future<Output = Result<AccessToken, AccessError>> + Send;

  /// Returns the authenticated account ID for a user-scoped operation.
  ///
  /// # Errors
  ///
  /// Returns an error if the credential cannot identify a valid Discord account.
  fn user_id(
    &self,
    credential: &Credential,
  ) -> impl Future<Output = Result<NonZeroU64, AccessError>> + Send;

  /// Resolves the caller's current membership, role IDs, and administrator status in `guild`.
  ///
  /// # Errors
  ///
  /// Returns an error if identity or current membership cannot be verified for the guild.
  fn membership(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Membership, AccessError>> + Send;

  /// Requires the caller to administer `guild` and returns the channels Botge can join.
  ///
  /// # Errors
  ///
  /// Returns an error if the caller is not an administrator or Discord access and channel
  /// permissions cannot be verified.
  fn voice_channels(
    &self,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> impl Future<Output = Result<Vec<VoiceChannel>, AccessError>> + Send;
}

impl std::fmt::Debug for Credential {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("Credential([redacted])")
  }
}
/// Transport-independent failure categories mapped to responses by each adapter.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FailureKind {
  /// A credential cannot establish the caller identity.
  Unauthenticated,
  /// The request violates a domain or operation constraint.
  InvalidInput,
  /// Current permissions do not allow the operation.
  PermissionDenied,
  /// The requested saved or provider record does not exist.
  NotFound,
  /// The mutation conflicts with current saved state.
  Conflict,
  /// An external provider could not complete the request.
  Upstream,
  /// Local storage or worker execution failed.
  Internal,
}
/// A failure category and a client-safe message. Upstream details stay in the logs.
#[derive(Debug)]
pub struct AccessError(
  /// Client-visible failure category.
  pub FailureKind,
  /// Sanitized message safe to return to the caller.
  pub &'static str,
);

impl AccessError {
  /// A sanitized unauthorized failure.
  pub const UNAUTHORIZED: Self = Self(
    FailureKind::Unauthenticated,
    "Discord authorization expired. Try again.",
  );
  /// A sanitized oauth configuration failure.
  pub const OAUTH_CONFIGURATION: Self = Self(
    FailureKind::Upstream,
    "Discord rejected Botge's OAuth configuration. Check the application ID and Activity client secret.",
  );
  /// A sanitized forbidden failure.
  pub const FORBIDDEN: Self = Self(
    FailureKind::PermissionDenied,
    "Only the server owner or an administrator can manage voice settings.",
  );
  /// A sanitized not member failure.
  pub const NOT_MEMBER: Self = Self(
    FailureKind::PermissionDenied,
    "Could not verify your server membership.",
  );
  /// A sanitized invalid failure.
  pub const INVALID: Self = Self(FailureKind::InvalidInput, "Invalid Activity request.");

  /// Logs an upstream failure and returns a generic gateway error to the Activity.
  pub fn upstream(error: impl std::fmt::Display) -> Self {
    tracing::warn!(%error, message = "Discord request failed");
    Self(
      FailureKind::Upstream,
      "Discord is unavailable. Try again shortly.",
    )
  }

  /// Logs a local failure while keeping its details out of the HTTP response.
  pub fn internal(error: impl std::fmt::Display) -> Self {
    tracing::error!(%error, message = "Activity request failed locally");
    Self(
      FailureKind::Internal,
      "Botge could not complete the request. Try again.",
    )
  }
}

/// Resolves current membership within the application lookup deadline.
///
/// # Errors
/// Propagates identity/permission failures and maps lookup timeouts to an upstream failure.
pub async fn membership<A: GuildAccess>(
  access: &A,
  guild: NonZeroU64,
  credential: &Credential,
) -> Result<Membership, AccessError> {
  tokio::time::timeout(
    std::time::Duration::from_secs(20),
    access.membership(guild, credential),
  )
  .await
  .map_err(AccessError::upstream)?
}
/// Resolves joinable channels within the application lookup deadline.
///
/// # Errors
/// Propagates permission failures and maps lookup timeouts to an upstream failure.
pub async fn channels<A: GuildAccess>(
  access: &A,
  guild: NonZeroU64,
  credential: &Credential,
) -> Result<Vec<VoiceChannel>, AccessError> {
  tokio::time::timeout(
    std::time::Duration::from_secs(25),
    access.voice_channels(guild, credential),
  )
  .await
  .map_err(AccessError::upstream)?
}

/// Resolves the current credential owner within the application identity deadline.
///
/// # Errors
/// Returns credential rejection or an upstream lookup timeout.
pub async fn user_id<A: GuildAccess>(
  access: &A,
  credential: &Credential,
) -> Result<NonZeroU64, AccessError> {
  tokio::time::timeout(
    std::time::Duration::from_secs(20),
    access.user_id(credential),
  )
  .await
  .map_err(AccessError::upstream)?
}

impl std::fmt::Debug for AccessToken {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("AccessToken")
      .field("expires_in", &self.expires_in)
      .finish_non_exhaustive()
  }
}
#[cfg(test)]
mod tests;

impl std::fmt::Display for AccessError {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str(self.1)
  }
}
impl std::error::Error for AccessError {}
