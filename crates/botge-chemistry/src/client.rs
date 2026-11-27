//! Bounded HTTP client for the chemistry sidecar's `POST /v1/react`.

use core::{error::Error, fmt};
use std::time::Duration;

use reqwest::{Response, Url, redirect::Policy};
use tokio::sync::Semaphore;

use crate::{ChemError, ReactRequest, ReactResponse, Secret};

/// Whole-request deadline, matching the quantum sidecar's 3-second bound.
const TIMEOUT: Duration = Duration::from_secs(3);

/// Maximum concurrent requests allowed against the sidecar.
const MAX_IN_FLIGHT: usize = 4;

/// Maximum JSON body size accepted (covers <= 128 KiB PNG base64 plus metadata).
const MAX_BODY_BYTES: usize = 256 * 1024;

/// Sends bimolecular reaction requests to the `RDKit` sidecar without retries or fallback.
#[derive(Debug)]
pub struct ChemistryClient {
  http: reqwest::Client,
  endpoint: Url,
  secret: Option<Secret>,
  in_flight: Semaphore,
}

impl ChemistryClient {
  /// Targets `v1/react` under `base`'s path with a 3-second deadline and no redirects.
  ///
  /// # Errors
  ///
  /// Returns [`ClientError::Url`] unless `base` is an `http` or `https` URL with a host and no
  /// query or fragment, and [`ClientError::Http`] if the HTTP client cannot be built.
  pub fn new(base: &Url, secret: Option<Secret>) -> Result<Self, ClientError> {
    Self::with_timeout(base, secret, TIMEOUT)
  }

  /// Builds the client with a custom deadline so tests can verify timeouts quickly.
  ///
  /// # Errors
  ///
  /// Returns the same errors as [`Self::new`].
  pub(crate) fn with_timeout(
    base: &Url,
    secret: Option<Secret>,
    timeout: Duration,
  ) -> Result<Self, ClientError> {
    let mut directory = base.clone();
    if !directory.path().ends_with('/') {
      directory.set_path(&format!("{}/", directory.path()));
    }
    let endpoint = directory
      .join("v1/react")
      .ok()
      .filter(|_| {
        matches!(base.scheme(), "http" | "https")
          && base.query().is_none()
          && base.fragment().is_none()
      })
      .ok_or(ClientError::Url)?;
    let http = reqwest::Client::builder()
      .timeout(timeout)
      .redirect(Policy::none())
      .user_agent("Botge")
      .build()
      .map_err(ClientError::Http)?;
    Ok(Self {
      http,
      endpoint,
      secret,
      in_flight: Semaphore::new(MAX_IN_FLIGHT),
    })
  }

  /// Evaluates `request` on the chemistry sidecar and returns the strictly decoded response.
  ///
  /// # Errors
  ///
  /// Returns [`ChemError::Busy`] when concurrency is saturated, [`ChemError::Refused`] for 4xx
  /// responses, [`ChemError::Unavailable`] for transport/timeout/5xx errors, and
  /// [`ChemError::Invalid`] for oversized or malformed JSON bodies.
  pub async fn react(&self, request: &ReactRequest) -> Result<ReactResponse, ChemError> {
    let Ok(_permit) = self.in_flight.try_acquire() else {
      return Err(ChemError::Busy);
    };
    self.send(request).await.map_err(|Failure(error, detail)| {
      tracing::warn!(
        outcome = error.label(),
        %detail,
        message = "chemistry sidecar request failed"
      );
      error
    })
  }

  /// Sends one reaction request and decodes the JSON response.
  ///
  /// # Errors
  ///
  /// Returns client-safe [`ChemError`] variants wrapped with operator log details.
  async fn send(&self, request: &ReactRequest) -> Result<ReactResponse, Failure> {
    let mut builder = self.http.post(self.endpoint.clone()).json(request);
    if let Some(secret) = &self.secret {
      builder = builder.bearer_auth(secret.expose());
    }
    let unavailable =
      |error: reqwest::Error| Failure(ChemError::Unavailable, error.without_url().to_string());
    let mut response = builder.send().await.map_err(unavailable)?;
    let status = response.status();
    if !status.is_success() {
      let error = if status.is_client_error() {
        ChemError::Refused
      } else {
        ChemError::Unavailable
      };
      return Err(Failure(error, format!("HTTP {}", status.as_u16())));
    }
    let body = read_body(&mut response).await?;
    serde_json::from_slice(&body).map_err(|error| Failure(ChemError::Invalid, error.to_string()))
  }
}

/// Reads a response body up to [`MAX_BODY_BYTES`].
///
/// # Errors
///
/// Returns [`ChemError::Invalid`] if the body exceeds [`MAX_BODY_BYTES`], or
/// [`ChemError::Unavailable`] if reading fails.
async fn read_body(response: &mut Response) -> Result<Vec<u8>, Failure> {
  let mut body = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|error| Failure(ChemError::Unavailable, error.without_url().to_string()))?
  {
    if body.len() + chunk.len() > MAX_BODY_BYTES {
      return Err(Failure(
        ChemError::Invalid,
        format!("response body exceeds {MAX_BODY_BYTES} bytes"),
      ));
    }
    body.extend_from_slice(&chunk);
  }
  Ok(body)
}

struct Failure(ChemError, String);

/// Why a [`ChemistryClient`] could not be configured.
#[derive(Debug)]
pub enum ClientError {
  /// Sidecar URL is not an `http` or `https` URL with a host and no query or fragment.
  Url,
  /// Underlying HTTP client failed to initialize.
  Http(reqwest::Error),
}

impl fmt::Display for ClientError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Url => f.write_str(
        "the chemistry sidecar URL must be an http or https URL with a host and no query or fragment",
      ),
      Self::Http(_) => f.write_str("the chemistry sidecar HTTP client could not be built"),
    }
  }
}

impl Error for ClientError {
  fn source(&self) -> Option<&(dyn Error + 'static)> {
    match self {
      Self::Url => None,
      Self::Http(error) => Some(error),
    }
  }
}

#[cfg(test)]
mod tests;
