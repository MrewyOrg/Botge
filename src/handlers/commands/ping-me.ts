import type { ChatInputCommandInteraction, Client, PermissionsBitField } from 'discord.js';
import type { Job } from 'node-schedule';

import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import { daysAndHoursAndMinutesToMilliseconds } from '../../bot/ping-utils.ts';
import type { PingsDatabase } from '../../database/pings-database.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import { PingForPingMeMessageBuilder } from '../../message-builders/ping-for-ping-me-message-builder.ts';
import type { MutableArray, Ping } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function pingMeHandler(
  pingsDatabase: Readonly<PingsDatabase>,
  pingMessageBuilders: MutableArray<Readonly<PingForPingMeMessageBuilder>>,
  client: Client,
  scheduledJobs: MutableArray<Readonly<Job>>
) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const defer = interaction.deferReply();
    try {
      const days = getOptionValue(interaction, 'days', Number);
      const hours = getOptionValue(interaction, 'hours', Number);
      const minutes = getOptionValue(interaction, 'minutes', Number);
      const message = getOptionValue(interaction, 'message');

      const interactionGuild = interaction.guild;
      if (interactionGuild === null) {
        await defer;
        await interaction.editReply(
          'The bot had to have been added as a server bot for this command to work.'
        );
        return;
      }

      if (days === undefined && hours === undefined && minutes === undefined) {
        await defer;
        await interaction.editReply('Either days, hours or minutes must be specified.');
        return;
      }

      if (days !== undefined && days < 1) {
        await defer;
        await interaction.editReply('Days must be at least 1.');
        return;
      }

      if (hours !== undefined && hours < 1) {
        await defer;
        await interaction.editReply('Hours must be at least 1.');
        return;
      }

      if (minutes !== undefined && minutes < 1) {
        await defer;
        await interaction.editReply('Minutes must be at least 1.');
        return;
      }

      if (message !== undefined && message.length > 1800) {
        await defer;
        await interaction.editReply('Message must be at most 1800 characters.');
        return;
      }

      const timeNow = Date.now();
      const pingDate = new Date(
        timeNow + daysAndHoursAndMinutesToMilliseconds(days ?? 0, hours ?? 0, minutes ?? 0)
      );

      const { channelId } = interaction;
      let channel: ReturnType<Client['channels']['cache']['get']> = undefined;

      try {
        channel = client.channels.cache.get(channelId);
        if (channel === undefined || !channel.isTextBased() || channel.isDMBased())
          throw new Error('Guild text channel not found.');
      } catch {
        await defer;
        await interaction.editReply('The command can only be used in a text channel.');
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
      ) {
        await defer;
        await interaction.editReply(
          'The bot does not have the permissions to either view this channel or to send messages in this channel.\n(Replying to command is different from sending messages.)'
        );
        return;
      }

      const userId = interaction.user.id;
      const ping: Ping = {
        time: timeNow,
        days: days ?? null,
        hours: hours ?? null,
        minutes: minutes ?? null,
        userId: userId,
        channelId: channelId,
        message: message ?? null,
        userIds: null,
        userIdRemoved: null
      };

      const pingMessageBuilder = new PingForPingMeMessageBuilder(
        interaction,
        ping,
        pingDate,
        channel,
        scheduledJobs,
        PingForPingMeMessageBuilder.messageBuilderTypeForPingMe,
        client
      );
      const reply = pingMessageBuilder.registerPing(pingsDatabase);
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(pingMessageBuilders, pingMessageBuilder);
    } catch (error) {
      logError(error, 'Error at pingMeHandler');

      await defer;
      await interaction.editReply('Failed to register the ping.');
    }
  };
}
