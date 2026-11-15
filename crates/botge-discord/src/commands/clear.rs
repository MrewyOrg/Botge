//! Confirms administrator message cleanup and deletes eligible messages before its cutoff.
//!
//! The modal binds the caller and channel to the original interaction. Submission rechecks
//! permissions; deletion is incremental, so failures can leave a partially cleared history.
//! Messages younger than two weeks are bulk-deleted 100 at a time; Discord requires older
//! messages to be deleted one by one. A run stops after twelve minutes so its report arrives
//! before the interaction token expires, and the administrator can run it again to continue.

use std::time::Duration;

use anyhow::Result;
use serenity::{
  all::{
    ActionRowComponent, ChannelId, ChannelType, CommandInteraction, InputTextStyle, InteractionId,
    Member, MessageId, ModalInteraction, Permissions, Timestamp, UserId,
  },
  builder::{
    CreateActionRow, CreateInputText, CreateInteractionResponse, CreateInteractionResponseMessage,
    CreateModal, EditInteractionResponse, GetMessages,
  },
  http::Http,
};

pub(super) const NAME: &str = "clear-messages";
const PREFIX: &str = "clear-messages:";
const CONFIRMATION: &str = "confirm";
/// Discord bulk-deletes only messages younger than 14 days; an hour of margin covers clock skew.
const BULK_MAX_AGE_SECONDS: i64 = 14 * 24 * 60 * 60 - 60 * 60;
/// Stops early enough to edit the reply before the 15-minute interaction token expires.
const RUN_BUDGET: Duration = Duration::from_mins(12);
const REQUIRED: Permissions = Permissions::VIEW_CHANNEL
  .union(Permissions::MANAGE_MESSAGES)
  .union(Permissions::READ_MESSAGE_HISTORY);

/// Explains missing caller or bot permissions for a clear operation.
fn denied(member: Option<&Member>, app_permissions: Option<Permissions>) -> Option<&'static str> {
  if !member
    .and_then(|member| member.permissions)
    .is_some_and(Permissions::administrator)
  {
    return Some("Only server administrators can clear messages.");
  }
  if !app_permissions
    .is_some_and(|permissions| permissions.administrator() || permissions.contains(REQUIRED))
  {
    return Some("Botge needs View Channel, Read Message History, and Manage Messages.");
  }
  None
}

/// Opens a confirmation bound to the invoking user, channel, and interaction.
///
/// # Errors
///
/// Returns an error if the confirmation modal or permission-denial response cannot be sent.
pub(super) async fn open(http: &Http, command: &CommandInteraction) -> Result<()> {
  let response = if command.guild_id.is_none()
    || !command.channel.as_ref().is_some_and(|channel| {
      matches!(
        channel.kind,
        ChannelType::Text
          | ChannelType::News
          | ChannelType::NewsThread
          | ChannelType::PublicThread
          | ChannelType::PrivateThread
      )
    })
  {
    message("Use this command in a server text channel or thread.")
  } else if let Some(reason) = denied(command.member.as_deref(), command.app_permissions) {
    message(reason)
  } else {
    let id = format!(
      "{PREFIX}{}:{}:{}",
      command.user.id, command.channel_id, command.id
    );
    let field = CreateInputText::new(
      InputTextStyle::Short,
      "Type Yes to delete earlier unpinned messages",
      CONFIRMATION,
    )
    .max_length(3)
    .placeholder("Yes");
    CreateInteractionResponse::Modal(
      CreateModal::new(id, "Delete channel messages")
        .components(vec![CreateActionRow::InputText(field)]),
    )
  };
  command.create_response(http, response).await?;
  Ok(())
}

/// Builds a response visible only to the invoking user.
fn message(content: &str) -> CreateInteractionResponse {
  CreateInteractionResponse::Message(
    CreateInteractionResponseMessage::new()
      .content(content)
      .ephemeral(true),
  )
}

/// Validates the confirmation and recovers the original invocation as a deletion cutoff.
///
/// The response must come from the same user and channel within 60 seconds and contain
/// the exact confirmation text. Messages created at or after the cutoff are excluded.
fn confirmed_before(modal: &ModalInteraction) -> Option<MessageId> {
  let id = modal.data.custom_id.strip_prefix(PREFIX)?;
  let (user, rest) = id.split_once(':')?;
  let (channel, invocation) = rest.split_once(':')?;
  let invocation: InteractionId = invocation.parse().ok()?;
  let elapsed = modal.id.created_at().unix_timestamp() - invocation.created_at().unix_timestamp();
  if user.parse::<UserId>().ok()? != modal.user.id
    || channel.parse::<ChannelId>().ok()? != modal.channel_id
    || !(0..=60).contains(&elapsed)
    || !modal
      .data
      .components
      .iter()
      .flat_map(|row| &row.components)
      .any(|component| {
        matches!(component, ActionRowComponent::InputText(input)
                if input.custom_id == CONFIRMATION && input.value.as_deref() == Some("Yes"))
      })
  {
    return None;
  }
  Some(MessageId::new(invocation.get()))
}

/// Rechecks permissions at submission before deleting any messages.
///
/// # Errors
///
/// Returns Discord HTTP or deletion errors after validating the confirmation. Earlier
/// deletions remain applied if a later request fails.
pub(super) async fn confirm(http: &Http, modal: ModalInteraction) -> Result<()> {
  if !modal.data.custom_id.starts_with(PREFIX) {
    return Ok(());
  }
  if let Some(reason) = denied(modal.member.as_ref(), modal.app_permissions) {
    modal.create_response(http, message(reason)).await?;
    return Ok(());
  }
  let Some(before) = confirmed_before(&modal) else {
    modal
      .create_response(http, message("Clear messages canceled or expired."))
      .await?;
    return Ok(());
  };
  modal.defer_ephemeral(http).await?;
  let deadline = tokio::time::Instant::now() + RUN_BUDGET;
  let feedback = match purge(
    http,
    modal.channel_id,
    before,
    modal.id.created_at(),
    deadline,
  )
  .await
  {
    Ok(Purge {
      deleted,
      complete: true,
    }) => format!("Deleted {deleted} earlier messages."),
    Ok(Purge {
      deleted,
      complete: false,
    }) => format!("Deleted {deleted} earlier messages so far. Run /{NAME} again to continue."),
    Err(error) => {
      tracing::warn!(%error, message = "could not clear channel");
      "Could not clear all messages. Some may already have been deleted.".into()
    }
  };
  modal
    .edit_response(http, EditInteractionResponse::new().content(feedback))
    .await?;
  Ok(())
}

/// How far one run got before it finished or reached its time budget.
#[derive(Debug, Eq, PartialEq)]
struct Purge {
  /// Messages Discord accepted for deletion.
  deleted: usize,
  /// Whether every eligible message before the cutoff was handled.
  complete: bool,
}

/// Walks backward from the cutoff and deletes unpinned messages until history or time runs out.
///
/// Messages younger than [`BULK_MAX_AGE_SECONDS`] relative to `now` are bulk-deleted per page;
/// older ones are deleted individually. Pinned messages are skipped but still advance the scan.
/// The deadline is checked before each request, so a run never starts work it cannot report.
///
/// # Errors
///
/// Returns an error if history cannot be read or Discord refuses a deletion for a reason other
/// than an already deleted message. Earlier deletions remain applied.
async fn purge(
  http: &Http,
  channel: ChannelId,
  mut before: MessageId,
  now: Timestamp,
  deadline: tokio::time::Instant,
) -> Result<Purge> {
  let bulk_cutoff = now.unix_timestamp() - BULK_MAX_AGE_SECONDS;
  let mut deleted = 0;
  let incomplete = |deleted| {
    Ok(Purge {
      deleted,
      complete: false,
    })
  };
  loop {
    if tokio::time::Instant::now() >= deadline {
      return incomplete(deleted);
    }
    let messages = channel
      .messages(http, GetMessages::new().before(before).limit(100))
      .await?;
    let mut next = before;
    let mut recent = Vec::new();
    let mut old = Vec::new();
    for message in messages.iter().filter(|message| message.id < before) {
      // Advance past pinned messages too, so they cannot stall pagination.
      next = next.min(message.id);
      if message.pinned {
        continue;
      }
      if message.id.created_at().unix_timestamp() > bulk_cutoff {
        recent.push(message.id);
      } else {
        old.push(message.id);
      }
    }
    if let [_, _, ..] = recent.as_slice() {
      // Discord counts IDs that no longer exist, so concurrent deletions cannot fail the batch.
      channel.delete_messages(http, &recent).await?;
      deleted += recent.len();
    } else {
      old.extend(recent);
    }
    for id in old {
      if tokio::time::Instant::now() >= deadline {
        return incomplete(deleted);
      }
      if delete_one(http, channel, id).await? {
        deleted += 1;
      }
    }
    if next == before {
      return Ok(Purge {
        deleted,
        complete: true,
      });
    }
    before = next;
  }
}

/// Deletes one message, treating a message that is already gone as not deleted.
///
/// # Errors
///
/// Returns any Discord error other than Unknown Message (10008).
async fn delete_one(http: &Http, channel: ChannelId, id: MessageId) -> Result<bool> {
  match channel.delete_message(http, id).await {
    Ok(()) => Ok(true),
    Err(serenity::Error::Http(serenity::http::HttpError::UnsuccessfulRequest(response)))
      if response.error.code == 10008 =>
    {
      Ok(false)
    }
    Err(error) => Err(error.into()),
  }
}

#[cfg(test)]
mod tests;
