//! `/react-emote`: reacts two catalog emotes in the `RDKit` sidecar and renders the result.
//!
//! Exists only when `BOTGE_CHEMISTRY_URL` configures a [`ChemistryClient`]. Defers first,
//! resolves `reactant_a` and `reactant_b` from the guild catalog, queries the sidecar outside the
//! render permit, and renders the projected `(base, overlay)` pair through
//! [`botge_app::Application::compose_selected`], optionally attaching the dark-mode 2D skeletal
//! reaction PNG in a follow-up reply to the emote message (falling back to an interaction followup
//! when channel messages are unavailable). Incompatible pairs and sidecar failures delete the
//! deferred placeholder before sending an ephemeral explanation.

use std::num::NonZeroU64;

use anyhow::Result;
use botge_app::{ChemistryOutcome, SelectedRequest};
use botge_chemistry::{ChemError, ChemistryClient, Condition, Diagram, Outcome, Plan, Pools, Size};
use botge_domain::emotes::find_emote;
use serenity::{
  all::{CommandDataOption, CommandDataOptionValue, CommandInteraction},
  builder::{
    CreateAllowedMentions, CreateAttachment, CreateInteractionResponseFollowup, CreateMessage,
    EditInteractionResponse,
  },
  http::Http,
};

use super::{
  Answer, Commands,
  compose::{DEADLINE, FAILED, TIMED_OUT},
  option, string,
};

/// The slash command name.
pub(super) const NAME: &str = "react-emote";

/// How one chemistry request ended.
#[derive(Debug)]
enum Reaction {
  /// Rendered emote bytes, optional 2D skeletal PNG, and reaction caption.
  Reacted {
    bytes: Vec<u8>,
    filename: &'static str,
    diagram_png: Option<Vec<u8>>,
    caption: String,
  },
  /// Why no emote was produced, shown ephemerally to the requester.
  Failed(String),
}

impl Commands {
  /// Answers a deferred `/react-emote` interaction.
  ///
  /// # Errors
  ///
  /// Returns Discord HTTP errors while editing, deleting, or following up on the reply.
  pub(super) async fn respond_chemistry(
    &self,
    http: &Http,
    command: &CommandInteraction,
    client: &ChemistryClient,
  ) -> Result<()> {
    let guild = command
      .guild_id
      .and_then(|guild| NonZeroU64::new(guild.get()));
    let user = NonZeroU64::new(command.user.id.get());
    let reaction = settle(
      tokio::time::timeout(
        DEADLINE,
        self.react(client, &command.data.options, guild, user),
      )
      .await,
      command.attachment_size_limit as usize,
    );
    match reaction {
      Reaction::Reacted {
        bytes,
        filename,
        diagram_png,
        caption,
      } => {
        let response = EditInteractionResponse::new()
          .allowed_mentions(CreateAllowedMentions::new())
          .content(caption)
          .new_attachment(CreateAttachment::bytes(bytes, filename));
        let message = command.edit_response(http, response).await?;
        if let Some(png) = diagram_png {
          let reply = CreateMessage::new()
            .reference_message(&message)
            .allowed_mentions(CreateAllowedMentions::new().replied_user(false))
            .add_file(CreateAttachment::bytes(png.clone(), "reaction.png"));
          if command.channel_id.send_message(http, reply).await.is_err() {
            let followup = CreateInteractionResponseFollowup::new()
              .allowed_mentions(CreateAllowedMentions::new())
              .add_file(CreateAttachment::bytes(png, "reaction.png"));
            command.create_followup(http, followup).await?;
          }
        }
      }
      Reaction::Failed(reason) => {
        command.delete_response(http).await?;
        let followup = CreateInteractionResponseFollowup::new()
          .allowed_mentions(CreateAllowedMentions::new())
          .ephemeral(true)
          .content(reason);
        command.create_followup(http, followup).await?;
      }
    }
    Ok(())
  }

  /// Resolves reactants, queries the sidecar, and renders the projected emotes.
  ///
  /// # Errors
  ///
  /// Returns catalog, lookup, or rendering errors; invalid options and sidecar failures map to
  /// [`Reaction::Failed`].
  async fn react(
    &self,
    client: &ChemistryClient,
    options: &[CommandDataOption],
    guild: Option<NonZeroU64>,
    user: Option<NonZeroU64>,
  ) -> Result<Reaction> {
    let (query_a, query_b, condition, size, diagram) = match parse_options(options) {
      Ok(parsed) => parsed,
      Err(reason) => return Ok(Reaction::Failed(reason)),
    };

    let metrics = self.application.metrics();
    let catalog = self.application.catalog(guild).await?;
    let Some(emote_a) = find_emote(&catalog, query_a) else {
      return Ok(Reaction::Failed(format!(
        "Could not find an unambiguous emote matching `{}` in this catalog.",
        query_a.replace('`', ""),
      )));
    };
    let Some(emote_b) = find_emote(&catalog, query_b) else {
      return Ok(Reaction::Failed(format!(
        "Could not find an unambiguous emote matching `{}` in this catalog.",
        query_b.replace('`', ""),
      )));
    };

    let pools = match Pools::new(&catalog) {
      Ok(pools) => pools,
      Err(error) => {
        metrics.chemistry(ChemistryOutcome::TooFew);
        return Ok(Reaction::Failed(format!(
          "Cannot run an emote reaction: {error}."
        )));
      }
    };
    let plan = Plan::new(pools, emote_a, emote_b, condition, diagram);
    let outcome = match client
      .react(&plan.request())
      .await
      .and_then(|response| plan.resolve(response))
    {
      Ok(outcome) => outcome,
      Err(error) => {
        metrics.chemistry(outcome_metric(error));
        return Ok(Reaction::Failed(error.to_string()));
      }
    };

    let selection = match outcome {
      Outcome::Reacted(selection) => selection,
      Outcome::NoReaction(report) => {
        metrics.chemistry(ChemistryOutcome::NoReaction);
        return Ok(Reaction::Failed(report.to_string()));
      }
    };
    metrics.chemistry(ChemistryOutcome::Reacted);
    let caption = selection.to_string();
    let diagram_png = selection.diagram_png().map(<[u8]>::to_vec);
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
      Answer::Image(image) => Reaction::Reacted {
        bytes: image.bytes,
        filename: image.filename,
        diagram_png,
        caption,
      },
      Answer::Text(reason) => Reaction::Failed(reason),
    })
  }
}

/// Parses `/react-emote` slash command options into validated inputs.
///
/// # Errors
///
/// Returns a user-facing validation message when a reactant, condition, or size is invalid.
fn parse_options(
  options: &[CommandDataOption],
) -> std::result::Result<(&str, &str, Condition, Size, Diagram), String> {
  let Some(query_a) = string(options, "reactant_a") else {
    return Err("Choose two emotes (`reactant_a` and `reactant_b`) to react.".into());
  };
  let Some(query_b) = string(options, "reactant_b") else {
    return Err("Choose two emotes (`reactant_a` and `reactant_b`) to react.".into());
  };
  let condition = match string(options, "condition") {
    Some(raw) => Condition::parse_option(raw)
      .ok_or_else(|| "Choose `condition` from auto, heat, acid, base, or palladium.".to_owned())?,
    None => Condition::Auto,
  };
  let size = match option(options, "size") {
    Some(&CommandDataOptionValue::Integer(value)) => {
      Size::try_from(value).map_err(|error| error.to_string())?
    }
    _ => Size::default(),
  };
  let diagram = match option(options, "diagram") {
    Some(&CommandDataOptionValue::Boolean(false)) => Diagram::Omit,
    _ => Diagram::Include,
  };
  Ok((query_a, query_b, condition, size, diagram))
}

fn settle(result: Result<Result<Reaction>, tokio::time::error::Elapsed>, limit: usize) -> Reaction {
  match result {
    Ok(Ok(Reaction::Reacted {
      bytes,
      diagram_png,
      ..
    })) if bytes.len() > limit || diagram_png.as_ref().is_some_and(|png| png.len() > limit) => {
      Reaction::Failed(
        "The rendered emote or reaction diagram exceeds Discord's upload limit. Try a smaller size or set `diagram` to false."
          .into(),
      )
    }
    Ok(Ok(reaction)) => reaction,
    Ok(Err(error)) => {
      tracing::warn!(%error, message = "chemistry emote request failed");
      let elapsed = error.is::<tokio::time::error::Elapsed>();
      Reaction::Failed(if elapsed { TIMED_OUT } else { FAILED }.into())
    }
    Err(_) => Reaction::Failed(TIMED_OUT.into()),
  }
}

const fn outcome_metric(error: ChemError) -> ChemistryOutcome {
  match error {
    ChemError::Busy => ChemistryOutcome::Busy,
    ChemError::Unavailable => ChemistryOutcome::Unavailable,
    ChemError::Refused => ChemistryOutcome::Refused,
    ChemError::Invalid => ChemistryOutcome::Invalid,
  }
}

#[cfg(test)]
mod tests;
