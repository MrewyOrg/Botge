//! Application composition workflow: resolution, saved preferences and render admission.
use super::{Application, Catalog, metrics::Outcome};
use anyhow::Result;
use botge_domain::emotes::{find_emote, valid_seven_id};
use botge_emotes::rendering::{self, Layer, RenderOptions};
use std::{num::NonZeroU64, time::Instant};
use url::Url;

/// Validated command intent, independent of Discord interaction types.
#[derive(Clone, Copy, Debug)]
pub struct ComposeRequest<'a> {
  /// Input names or explicit provider/media references, in display order.
  pub input: &'a str,
  /// Guild whose enabled catalog should be resolved.
  pub guild: Option<NonZeroU64>,
  /// Authenticated command author whose saved border applies.
  pub user: Option<NonZeroU64>,
  /// Provider variant scale, defaulting to two.
  pub scale: Option<u16>,
  /// Whether layers stretch to the selected column height.
  pub stretch: bool,
  /// Optional operator-configured media cache URL.
  pub cache: Option<&'a Url>,
}
/// A composition outcome for an adapter to format or upload.
#[derive(Debug)]
pub enum Composition {
  /// A safe explanation of an unavailable or rejected composition.
  Text(String),
  /// Encoded image bytes ready to attach to the response.
  Image(rendering::Image),
}
impl Application {
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
    self.border_for_user(user).await
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
    catalog: &Catalog,
    token: &str,
    scale: u16,
  ) -> Result<Option<Layer>> {
    if let Some(id) = token.strip_prefix("7tv:") {
      return Ok(
        self
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
  /// Every outcome is counted in [`Self::metrics`]; images also record their duration.
  pub async fn compose(&self, request: ComposeRequest<'_>) -> Result<Composition> {
    let started = Instant::now();
    let tokens: Vec<_> = request.input.split_whitespace().take(33).collect();
    if tokens.is_empty() || tokens.len() > 32 {
      self
        .metrics
        .composition(Outcome::Rejected, started.elapsed());
      return Ok(Composition::Text("Enter between 1 and 32 emotes.".into()));
    }
    let Ok(_permit) = self.render_slot.try_acquire() else {
      self.metrics.composition(Outcome::Busy, started.elapsed());
      return Ok(Composition::Text(
        "Botge is rendering too many emotes right now. Try again shortly.".into(),
      ));
    };
    let result = self.compose_admitted(request, tokens).await;
    let outcome = match &result {
      Ok(Composition::Image(_)) => Outcome::Image,
      Ok(Composition::Text(_)) => Outcome::Rejected,
      Err(_) => Outcome::Error,
    };
    self.metrics.composition(outcome, started.elapsed());
    result
  }

  /// Resolves and renders admitted input while the caller holds the render permit.
  ///
  /// # Errors
  ///
  /// Returns catalog, preference, provider lookup, download, or rendering failures.
  async fn compose_admitted<'a>(
    &self,
    request: ComposeRequest<'a>,
    mut tokens: Vec<&'a str>,
  ) -> Result<Composition> {
    let ComposeRequest {
      input,
      guild,
      user,
      scale,
      stretch,
      cache,
    } = request;
    let catalog = self.catalog(guild).await?;
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
          return Ok(Composition::Text(format!(
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
      return Ok(Composition::Image(
        rendering::original(self.client.http(), layer, cache).await?,
      ));
    }
    let image = rendering::compose(
      self.client.http(),
      &layers,
      cache,
      RenderOptions {
        size_pixels: None,
        stretch,
        border,
      },
    )
    .await?;
    Ok(Composition::Image(image))
  }
}

#[cfg(test)]
mod tests;
