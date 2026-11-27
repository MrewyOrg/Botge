//! `/quantum-emote`: draws a base emote and an overlay from one shot of the Q# sidecar's circuit.
//!
//! The command exists only when `BOTGE_QUANTUM_URL` configures a [`QuantumClient`]. It defers
//! first, asks the sidecar outside the render permit, and renders the drawn pair through
//! [`botge_app::Application::compose_selected`]. Nothing is retried and no classical randomness
//! replaces a failed draw: failures explain themselves ephemerally and delete the deferred reply.

use std::num::NonZeroU64;

use anyhow::Result;
use botge_app::{QuantumOutcome, SelectedRequest};
use botge_quantum::{OutOfRange, Plan, Pools, QuantumClient, QuantumError, Size, Steps};
use serenity::{
  all::{CommandDataOption, CommandDataOptionValue, CommandInteraction},
  builder::{
    CreateAllowedMentions, CreateAttachment, CreateInteractionResponseFollowup,
    EditInteractionResponse,
  },
  http::Http,
};

use super::{
  Answer, Commands,
  compose::{DEADLINE, FAILED, TIMED_OUT},
  option,
};

/// The slash command name.
pub(super) const NAME: &str = "quantum-emote";

/// How one quantum request ended.
#[derive(Debug)]
enum Draw {
  /// The rendered pair and the caption naming the circuit and both emotes.
  Drawn {
    /// Encoded image bytes.
    bytes: Vec<u8>,
    /// Upload filename chosen by the renderer.
    filename: &'static str,
    /// Caption naming the circuit and both emotes.
    caption: String,
  },
  /// Why nothing was drawn, shown only to the requester.
  Failed(String),
}

impl Commands {
  /// Answers a deferred `/quantum-emote` interaction.
  ///
  /// # Errors
  ///
  /// Returns Discord HTTP errors while editing, deleting or following up on the reply. Draw
  /// failures are explained to the requester instead.
  pub(super) async fn respond_quantum(
    &self,
    http: &Http,
    command: &CommandInteraction,
    client: &QuantumClient,
  ) -> Result<()> {
    let guild = command
      .guild_id
      .and_then(|guild| NonZeroU64::new(guild.get()));
    let user = NonZeroU64::new(command.user.id.get());
    let draw = settle(
      tokio::time::timeout(
        DEADLINE,
        self.draw(client, &command.data.options, guild, user),
      )
      .await,
      command.attachment_size_limit as usize,
    );
    match draw {
      Draw::Drawn {
        bytes,
        filename,
        caption,
      } => {
        let response = EditInteractionResponse::new()
          .allowed_mentions(CreateAllowedMentions::new())
          .content(caption)
          .new_attachment(CreateAttachment::bytes(bytes, filename));
        command.edit_response(http, response).await?;
      }
      // The explanation is sent before the public placeholder is removed, so a failed deletion
      // still leaves the requester an answer.
      Draw::Failed(reason) => {
        let followup = CreateInteractionResponseFollowup::new()
          .allowed_mentions(CreateAllowedMentions::new())
          .ephemeral(true)
          .content(reason);
        command.create_followup(http, followup).await?;
        command.delete_response(http).await?;
      }
    }
    Ok(())
  }

  /// Plans, samples and renders one draw without sending anything to Discord.
  ///
  /// # Errors
  ///
  /// Returns catalog, preference, provider lookup, download or rendering failures. Invalid
  /// options, small pools, sidecar failures and rejected compositions are [`Draw::Failed`].
  async fn draw(
    &self,
    client: &QuantumClient,
    options: &[CommandDataOption],
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
  ) -> Result<Draw> {
    let (steps, size) = match (
      bounded::<Steps>(options, "steps"),
      bounded::<Size>(options, "size"),
    ) {
      (Ok(steps), Ok(size)) => (steps, size),
      (Err(error), _) | (_, Err(error)) => return Ok(Draw::Failed(error.to_string())),
    };
    let metrics = self.application.metrics();
    let catalog = self.application.catalog(guild).await?;
    let pools = match Pools::new(&catalog) {
      Ok(pools) => pools,
      Err(error) => {
        metrics.quantum(QuantumOutcome::TooFew);
        return Ok(Draw::Failed(format!(
          "Cannot draw a quantum emote: {error}."
        )));
      }
    };
    let plan = Plan::new(pools, steps);
    let selection = match client
      .entangle(&plan.request())
      .await
      .and_then(|sample| plan.resolve(&sample))
    {
      Ok(selection) => selection,
      Err(error) => {
        metrics.quantum(outcome(error));
        return Ok(Draw::Failed(error.to_string()));
      }
    };
    metrics.quantum(QuantumOutcome::Sampled);
    let composition = self
      .application
      .compose_selected(SelectedRequest {
        emotes: &[selection.base(), selection.overlay()],
        user,
        scale: size.get(),
        cache: self.cache.as_ref(),
      })
      .await?;
    Ok(match composition {
      Answer::Image(image) => Draw::Drawn {
        bytes: image.bytes,
        filename: image.filename,
        caption: selection.to_string(),
      },
      Answer::Text(reason) => Draw::Failed(reason),
    })
  }
}

/// Turns a finished, failed or timed-out draw into the reply, refusing images over `limit` bytes.
fn settle(result: Result<Result<Draw>, tokio::time::error::Elapsed>, limit: usize) -> Draw {
  match result {
    Ok(Ok(Draw::Drawn { bytes, .. })) if bytes.len() > limit => Draw::Failed(
      "The rendered image exceeds Discord's upload limit for this interaction. Try a smaller size."
        .into(),
    ),
    Ok(Ok(draw)) => draw,
    Ok(Err(error)) => {
      tracing::warn!(%error, message = "quantum emote request failed");
      let elapsed = error.is::<tokio::time::error::Elapsed>();
      Draw::Failed(if elapsed { TIMED_OUT } else { FAILED }.into())
    }
    Err(_) => Draw::Failed(TIMED_OUT.into()),
  }
}

/// Reads an optional integer option into its bounded type, defaulting when it is absent.
///
/// # Errors
///
/// Returns [`OutOfRange`] for a supplied value outside the type's bounds; it is never clamped.
fn bounded<T: Default + TryFrom<i64, Error = OutOfRange>>(
  options: &[CommandDataOption],
  name: &str,
) -> Result<T, OutOfRange> {
  match option(options, name) {
    Some(&CommandDataOptionValue::Integer(value)) => T::try_from(value),
    _ => Ok(T::default()),
  }
}

/// The metric label for a failed draw.
const fn outcome(error: QuantumError) -> QuantumOutcome {
  match error {
    QuantumError::Busy => QuantumOutcome::Busy,
    QuantumError::Unavailable => QuantumOutcome::Unavailable,
    QuantumError::Refused => QuantumOutcome::Refused,
    QuantumError::Exhausted => QuantumOutcome::Exhausted,
    QuantumError::Invalid => QuantumOutcome::Invalid,
  }
}

#[cfg(test)]
mod tests;
