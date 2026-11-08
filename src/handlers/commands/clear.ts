import {
  type ChatInputCommandInteraction,
  type Client,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type PermissionsBitField,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { globalAdministrator, owner } from '../../discord/permissions.ts';
import { logError } from '../../utils/log-error.ts';

export function clearHandler(client: Client) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    let confirmation: ModalSubmitInteraction | undefined;
    try {
      const interactionGuild = interaction.guild;

      if (interactionGuild === null) {
        await interaction.reply({
          content: 'The bot had to have been added as a server bot for this command to work.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const member = await interactionGuild.members.fetch(interaction.user.id);

      if (!owner(member, interactionGuild) && !globalAdministrator(member)) {
        await interaction.reply({
          content: 'You do not have permission to use this command.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let channel: ReturnType<Client['channels']['cache']['get']> = undefined;
      try {
        channel = client.channels.cache.get(interaction.channelId);
        if (channel === undefined || !channel.isTextBased() || channel.isDMBased())
          throw new Error('Guild text channel not found.');
      } catch {
        await interaction.reply({
          content: 'The command can only be used in a text channel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const botPermissionsInChannel = ((): Readonly<PermissionsBitField> => {
        const { user } = client;
        if (user === null) throw new Error('Bot client user is empty.');

        const botAsMember = interactionGuild.members.cache.get(user.id);
        if (botAsMember === undefined) throw new Error('Bot is not in the guild.');

        const permissions = channel.permissionsFor(botAsMember);
        return permissions;
      })();

      if (
        !botPermissionsInChannel.has('ViewChannel')
        || !botPermissionsInChannel.has('SendMessages')
        || !botPermissionsInChannel.has('ManageMessages')
        || !botPermissionsInChannel.has('ReadMessageHistory')
      ) {
        await interaction.reply({
          content:
            'The bot does not have the permissions to either: view channel, send messages, manage messages or read message history.\n(Replying to command is different from sending messages.)',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const modalCustomId = `clearMessageModal:${interaction.id}`;
      const areYouSureAnswerTextInputCustomId = 'areYouSure';
      const modal = new ModalBuilder()
        .setCustomId(modalCustomId)
        .setTitle('Delete channel messages')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Confirm deletion')
            .setDescription('Type Yes to delete all earlier messages in this channel.')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId(areYouSureAnswerTextInputCustomId)
                .setMaxLength(3)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Yes')
                .setRequired(true)
            )
        );
      await interaction.showModal(modal);

      const modalSubmitInteraction = await interaction
        .awaitModalSubmit({
          filter: (modalSubmitInteraction_: ModalSubmitInteraction): boolean =>
            modalSubmitInteraction_.customId === modalCustomId
            && modalSubmitInteraction_.user.id === interaction.user.id,
          time: 60000
        })
        .catch(() => undefined); //timeout catch
      if (modalSubmitInteraction === undefined) return;
      confirmation = modalSubmitInteraction;

      const areYouSureAnswer = modalSubmitInteraction.fields.getTextInputValue(
        areYouSureAnswerTextInputCustomId
      );
      if (areYouSureAnswer !== 'Yes') {
        await modalSubmitInteraction.reply({
          content: 'Clear messages aborted.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

      // Only clear messages preceding this invocation. A cursor also keeps newly arriving
      // messages from extending the operation indefinitely.
      let before = interaction.id;
      for (;;) {
        const messages = await channel.messages.fetch({ limit: 100, before });
        if (messages.size === 0) break;
        for (const message of messages.values()) await message.delete();
        const oldestId = messages.lastKey();
        if (oldestId === undefined) break;
        before = oldestId;
      }

      await modalSubmitInteraction.editReply('Cleared messages.');
    } catch (error) {
      logError(error, 'Error at clearHandler');

      if (confirmation?.deferred === true) {
        await confirmation.editReply(
          'Failed to clear all messages. Some may already have been deleted.'
        );
        return;
      }
      if (interaction.replied) return; // if the error happens after interaction.showModal()

      await interaction.reply({
        content: 'Failed to clear messages.',
        flags: MessageFlags.Ephemeral
      });
    }
  };
}
