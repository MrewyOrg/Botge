//! The bounded HTTP client for the Q# sidecar's `POST /v1/entangle`.

use core::{error::Error, fmt};
use std::time::Duration;

use reqwest::{Response, StatusCode, Url, redirect::Policy};
use serde::Deserialize;
use tokio::sync::Semaphore;

use crate::{EntangleRequest, QuantumError, Sample, Secret};

/// Whole-request deadline, including time queued behind the sidecar's sampling lock.
///
/// A 16-qubit shot takes about 12 ms and acceptance exceeds 1/4 (Theorem 5.1), so a draw needs
/// fewer than four shots on average. The 256-shot budget behind HTTP 503 would take about as long
/// as this deadline, so that practically impossible case surfaces as a timeout instead.
const TIMEOUT: Duration = Duration::from_secs(3);

/// Requests that may wait on the sidecar at once; it serializes sampling behind one lock.
const MAX_IN_FLIGHT: usize = 4;

/// Largest response body read; a valid sample is under 100 bytes.
const MAX_BODY_BYTES: usize = 1024;

/// The `detail` of the sidecar's HTTP 503 when rejection sampling runs out of shots.
const EXHAUSTED_DETAIL: &str = "rejection sampling budget exhausted";

/// Sends entanglement requests to the Q# sidecar without retries or a classical fallback.
#[derive(Debug)]
pub struct QuantumClient {
  http: reqwest::Client,
  endpoint: Url,
  secret: Option<Secret>,
  in_flight: Semaphore,
}

impl QuantumClient {
  /// Targets `v1/entangle` under `base`'s path with a three-second deadline and no redirects.
  ///
  /// `secret`, when present, is sent as a Bearer token.
  ///
  /// # Errors
  ///
  /// Returns [`ClientError::Url`] unless `base` is an `http` or `https` URL with a host and no
  /// query or fragment, and [`ClientError::Http`] if the HTTP client cannot be built.
  pub fn new(base: &Url, secret: Option<Secret>) -> Result<Self, ClientError> {
    Self::with_timeout(base, secret, TIMEOUT)
  }

  /// Builds the client with a custom deadline so tests can exercise timeouts quickly.
  ///
  /// # Errors
  ///
  /// Returns the same errors as [`Self::new`].
  pub(crate) fn with_timeout(
    base: &Url,
    secret: Option<Secret>,
    timeout: Duration,
  ) -> Result<Self, ClientError> {
    // Every parsed `http` or `https` URL has a host, so the scheme check is sufficient. A base
    // path without a trailing slash is treated as a directory rather than replaced, and a query
    // or fragment, which joining would silently drop, is rejected.
    let mut directory = base.clone();
    if !directory.path().ends_with('/') {
      directory.set_path(&format!("{}/", directory.path()));
    }
    let endpoint = directory
      .join("v1/entangle")
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

  /// Requests one accepted shot of the circuit for `request`.
  ///
  /// The sample is decoded strictly but not checked against the pools; pass it to
  /// [`Plan::resolve`](crate::Plan::resolve).
  ///
  /// # Errors
  ///
  /// Returns [`QuantumError::Busy`] when too many requests are waiting, [`QuantumError::Exhausted`]
  /// for the sidecar's rejection-sampling HTTP 503, [`QuantumError::Refused`] for 4xx statuses,
  /// [`QuantumError::Unavailable`] for connection failures, timeouts and other statuses, and
  /// [`QuantumError::Invalid`] for an oversized or malformed body.
  pub async fn entangle(&self, request: &EntangleRequest) -> Result<Sample, QuantumError> {
    let Ok(_permit) = self.in_flight.try_acquire() else {
      return Err(QuantumError::Busy);
    };
    self.send(request).await.map_err(|Failure(error, detail)| {
      tracing::warn!(
        outcome = error.label(),
        %detail,
        message = "quantum sidecar request failed"
      );
      error
    })
  }

  /// Sends one request and decodes the body, keeping failure details for the log.
  ///
  /// # Errors
  ///
  /// Returns the [`QuantumError`] that [`Self::entangle`] reports, with its diagnostic detail.
  async fn send(&self, request: &EntangleRequest) -> Result<Sample, Failure> {
    let mut builder = self.http.post(self.endpoint.clone()).json(request);
    if let Some(secret) = &self.secret {
      builder = builder.bearer_auth(secret.expose());
    }
    let unavailable =
      |error: reqwest::Error| Failure(QuantumError::Unavailable, error.without_url().to_string());
    let mut response = builder.send().await.map_err(unavailable)?;
    let status = response.status();
    if !status.is_success() {
      // Only the sampler's own 503 means exhaustion; any other 503, such as one from a proxy in
      // front of the sidecar, means the sidecar is unavailable.
      let error = if status == StatusCode::SERVICE_UNAVAILABLE {
        if read_body(&mut response)
          .await
          .is_ok_and(|body| exhausted(&body))
        {
          QuantumError::Exhausted
        } else {
          QuantumError::Unavailable
        }
      } else if status.is_client_error() {
        QuantumError::Refused
      } else {
        QuantumError::Unavailable
      };
      return Err(Failure(error, format!("HTTP {}", status.as_u16())));
    }
    let body = read_body(&mut response).await?;
    serde_json::from_slice(&body).map_err(|error| Failure(QuantumError::Invalid, error.to_string()))
  }
}

/// Reads a response body of at most [`MAX_BODY_BYTES`].
///
/// # Errors
///
/// Returns [`QuantumError::Invalid`] for an oversized body and [`QuantumError::Unavailable`] when
/// the connection fails while reading.
async fn read_body(response: &mut Response) -> Result<Vec<u8>, Failure> {
  let mut body = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|error| Failure(QuantumError::Unavailable, error.without_url().to_string()))?
  {
    if body.len() + chunk.len() > MAX_BODY_BYTES {
      return Err(Failure(
        QuantumError::Invalid,
        format!("response body exceeds {MAX_BODY_BYTES} bytes"),
      ));
    }
    body.extend_from_slice(&chunk);
  }
  Ok(body)
}

/// The sidecar's JSON error body for a rejected request.
#[derive(Deserialize)]
struct Rejection {
  detail: String,
}

/// Whether `body` is the sidecar's rejection-sampling exhaustion error.
fn exhausted(body: &[u8]) -> bool {
  serde_json::from_slice::<Rejection>(body)
    .is_ok_and(|rejection| rejection.detail == EXHAUSTED_DETAIL)
}

/// A failed request: the client-safe error and a diagnostic detail for the operator log.
struct Failure(QuantumError, String);

/// Why a [`QuantumClient`] cannot be configured.
#[derive(Debug)]
pub enum ClientError {
  /// The sidecar URL is not an `http` or `https` URL with a host and no query or fragment.
  Url,
  /// The HTTP client could not be built.
  Http(reqwest::Error),
}

impl fmt::Display for ClientError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Url => f.write_str(
        "the quantum sidecar URL must be an http or https URL with a host and no query or fragment",
      ),
      Self::Http(_) => f.write_str("the quantum sidecar HTTP client could not be built"),
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
