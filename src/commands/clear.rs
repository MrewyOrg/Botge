use anyhow::Result;
use serenity::{
  all::{
    ActionRowComponent, ChannelId, ChannelType, CommandInteraction, InputTextStyle, InteractionId,
    Member, MessageId, ModalInteraction, Permissions, UserId,
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
  let feedback = match purge(http, modal.channel_id, before).await {
    Ok(count) => format!("Deleted {count} earlier messages."),
    Err(error) => {
      tracing::warn!(%error, "could not clear channel");
      "Could not clear all messages. Some may already have been deleted.".into()
    }
  };
  modal
    .edit_response(http, EditInteractionResponse::new().content(feedback))
    .await?;
  Ok(())
}

/// Walks backward from the command invocation and skips pinned or already deleted messages.
///
/// Counts only successful deletions. A concurrent deletion is harmless, but another
/// Discord error ends the scan and earlier deletions remain applied.
async fn purge(http: &Http, channel: ChannelId, mut before: MessageId) -> Result<usize> {
  let mut count = 0;
  loop {
    let messages = channel
      .messages(http, GetMessages::new().before(before).limit(100))
      .await?;
    let mut next = before;
    for message in messages.iter().filter(|message| message.id < before) {
      // Advance past pinned messages too, so they cannot stall pagination.
      next = next.min(message.id);
      if message.pinned {
        continue;
      }
      if let Err(error) = channel.delete_message(http, message.id).await {
        if matches!(&error, serenity::Error::Http(http) if matches!(http,
                    serenity::http::HttpError::UnsuccessfulRequest(response) if response.error.code == 10008))
        {
          continue;
        }
        return Err(error.into());
      }
      count += 1;
    }
    if next == before {
      return Ok(count);
    }
    before = next;
  }
}

#[cfg(test)]
mod tests;
