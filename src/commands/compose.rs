//! Resolves emote inputs, bounds rendering work, and converts failures into reply text.

use std::{future::Future, num::NonZeroU64, time::Duration};

use anyhow::Result;

use super::{Answer, Commands};
use crate::emotes::{
  Emote, find_emote,
  rendering::{self, Layer, RenderOptions},
  valid_seven_id,
};

impl Commands {
  /// Looks up a border only when the reply has an associated user.
  ///
  /// # Errors
  ///
  /// Returns saved-preference database or blocking-task errors. An absent user or saved border
  /// produces `Ok(None)`.
  async fn border(&self, user: Option<NonZeroU64>) -> Result<Option<u32>> {
    let Some(user) = user else {
      return Ok(None);
    };
    self.emotes.border_for_user(user).await
  }

  /// Resolves one token without changing the catalog or persisted guild additions.
  ///
  /// Explicit IDs fetch current 7TV metadata. Named additions saved without variants are
  /// refreshed for this render, retaining their saved overlay flag. Discord media is a fallback
  /// only when no catalog entry matches.
  ///
  /// # Errors
  ///
  /// Returns an error if resolving an individual 7TV emote fails. An unavailable or invalid
  /// media reference produces `Ok(None)`; no guild addition is persisted.
  async fn resolve_layer(
    &self,
    catalog: &[Emote],
    token: &str,
    scale: u16,
  ) -> Result<Option<Layer>> {
    if let Some(id) = token.strip_prefix("7tv:") {
      return Ok(
        self
          .emotes
          .fetch_added(id)
          .await?
          .as_ref()
          .and_then(|emote| Layer::emote_at(emote, scale)),
      );
    }
    let Some(emote) = find_emote(catalog, token) else {
      return Ok(Layer::discord(token));
    };
    if emote.sizes.is_empty() && emote.added && valid_seven_id(&emote.id) {
      return Ok(
        self
          .emotes
          .fetch_added(&emote.id)
          .await?
          .as_ref()
          .and_then(|fresh| {
            let mut layer = Layer::emote_at(fresh, scale)?;
            layer.overlay = emote.overlaying;
            Some(layer)
          }),
      );
    }
    Ok(Layer::emote_at(emote, scale))
  }

  /// Resolves the input in order and holds a render permit through the download and composition.
  ///
  /// A `7tv:` token resolves by ID when individual 7TV additions are enabled. Other tokens
  /// resolve against the catalog or Discord media syntax. If any token is unavailable,
  /// the reply identifies that token and skips the render. A single input without a border
  /// is sent as the selected provider variant's original attachment. Scale defaults to 2;
  /// the renderer receives native-size layers rather than the command's provider scale.
  ///
  /// # Errors
  ///
  /// Returns catalog, preference, provider lookup, download, or rendering failures.
  /// Missing input, unavailable names, and admission rejection are returned as text answers.
  pub(super) async fn compose(
    &self,
    input: &str,
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
    scale: Option<u16>,
    stretch: bool,
  ) -> Result<Answer> {
    let mut tokens: Vec<_> = input.split_whitespace().take(33).collect();
    if tokens.is_empty() || tokens.len() > 32 {
      return Ok(Answer::Text("Enter between 1 and 32 emotes.".into()));
    }
    let Ok(_permit) = self.render_slot.try_acquire() else {
      return Ok(Answer::Text(
        "Botge is rendering another emote. Try again shortly.".into(),
      ));
    };
    let catalog = self.emotes.catalog(guild).await?;
    // An exact catalog match can itself contain spaces.
    if tokens.len() > 1
      && catalog
        .iter()
        .any(|emote| emote.name.eq_ignore_ascii_case(input.trim()))
    {
      tokens = vec![input.trim()];
    }

    let scale = scale.unwrap_or(2);
    let mut layers = Vec::with_capacity(tokens.len());
    for batch in tokens.chunks(4) {
      let catalog = &catalog;
      let found = futures_util::future::join_all(batch.iter().map(|&name| async move {
        let layer = self.resolve_layer(catalog, name, scale).await?;
        Ok::<_, anyhow::Error>((name, layer))
      }))
      .await;
      for result in found {
        let (name, layer) = result?;
        let Some(layer) = layer else {
          return Ok(Answer::Text(format!(
            "No available emote matches `{}`.",
            name.replace('`', "").chars().take(100).collect::<String>()
          )));
        };
        layers.push(layer);
      }
    }

    let border = self.border(user).await?;
    // A single unmodified image can retain its original bytes and timing.
    if let [layer] = layers.as_slice()
      && border.is_none()
    {
      return Ok(Answer::Image(
        rendering::original(self.emotes.http(), layer, self.cache.as_ref()).await?,
      ));
    }
    let image = rendering::compose(
      self.emotes.http(),
      &layers,
      self.cache.as_ref(),
      RenderOptions {
        size_pixels: None,
        stretch,
        border,
      },
    )
    .await?;
    Ok(Answer::Image(image))
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
      tracing::warn!(%error, "emote request failed");
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
