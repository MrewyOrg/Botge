//! Resolves emote inputs, bounds rendering work, and converts failures into reply text.

use std::{num::NonZeroU64, time::Duration};

use anyhow::Result;

use super::{Answer, Commands};
impl Commands {
  /// Translates Discord command arguments into one shared application composition request.
  ///
  /// # Errors
  /// Returns application catalog, preference, provider or rendering failures.
  pub(super) async fn compose(
    &self,
    input: &str,
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
    scale: Option<u16>,
    stretch: bool,
  ) -> Result<Answer> {
    self
      .application
      .compose(botge_app::ComposeRequest {
        input,
        guild,
        user,
        scale,
        stretch,
        cache: self.cache.as_ref(),
      })
      .await
  }
}

/// Applies the reply deadline and converts failures to user-facing messages.
pub(super) async fn render_reply(answer: impl Future<Output = Result<Answer>>) -> Answer {
  render_result(tokio::time::timeout(Duration::from_secs(40), answer).await)
}

/// Converts completed or timed-out work into a client-safe reply without exposing error details.
fn render_result(result: Result<Result<Answer>, tokio::time::error::Elapsed>) -> Answer {
  match result {
    Ok(Ok(answer)) => answer,
    Ok(Err(error)) => {
      tracing::warn!(%error, message = "emote request failed");
      if error.is::<tokio::time::error::Elapsed>() {
        Answer::Text("The emote request timed out. Try again.".into())
      } else {
        Answer::Text("Could not load or render those emotes.".into())
      }
    }
    Err(_) => Answer::Text("The emote request timed out. Try again.".into()),
  }
}

#[cfg(test)]
mod tests;
