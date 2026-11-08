import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Job } from 'node-schedule';

import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import { daysAndHoursAndMinutesToMilliseconds } from '../../bot/ping-utils.ts';
import type { PingsDatabase } from '../../database/pings-database.ts';
import { PING_LIST } from '../../discord/command-names.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import { PingForPingListMessageBuilder } from '../../message-builders/ping-for-ping-list-message-builder.ts';
import { PingForPingMeMessageBuilder } from '../../message-builders/ping-for-ping-me-message-builder.ts';
import type { MutableArray, Ping } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function pingListHandler(
  pingsDatabase: Readonly<PingsDatabase>,
  pingForPingListMessageBuilders: MutableArray<Readonly<PingForPingListMessageBuilder>>,
  client: Client,
  scheduledJobs: MutableArray<Readonly<Job>>
) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const defer = interaction.deferReply();
    try {
      const type = getOptionValue(interaction, 'type');
      const timezone = getOptionValue(interaction, 'timezone');

      const pingForPingMeMessageBuilders = ((): readonly PingForPingMeMessageBuilder[] => {
        const interactionChannels = interaction.guild?.channels.cache;
        if (interactionChannels === undefined) return [];

        const pings = ((): readonly Ping[] => {
          const storedPings = pingsDatabase
            .getAll()
            .filter((ping) => interactionChannels.has(ping.channelId));

          return type === PING_LIST.type.own ?
              storedPings.filter((ping) => ping.userId === interaction.user.id)
            : storedPings;
        })();

        const candidateBuilders: readonly (PingForPingMeMessageBuilder | undefined)[] = pings.map(
          (ping) => {
            const { time, days, hours, minutes, channelId } = ping;

            let channel: ReturnType<Client['channels']['cache']['get']>;
            try {
              channel = client.channels.cache.get(channelId);
              if (channel === undefined || !channel.isTextBased() || channel.isDMBased())
                return undefined;
            } catch {
              return undefined;
            }

            const timeMilliseconds =
              time + daysAndHoursAndMinutesToMilliseconds(days ?? 0, hours ?? 0, minutes ?? 0);
            const pingDate = new Date(timeMilliseconds);

            return new PingForPingMeMessageBuilder(
              interaction,
              ping,
              pingDate,
              channel,
              scheduledJobs,
              PingForPingMeMessageBuilder.messageBuilderTypeForPingList,
              client
            );
          }
        );

        const availableBuilders: PingForPingMeMessageBuilder[] = [];
        for (const pingForPingMeMessageBuilder of candidateBuilders) {
          if (pingForPingMeMessageBuilder !== undefined)
            availableBuilders.push(pingForPingMeMessageBuilder);
        }

        return availableBuilders;
      })();

      if (pingForPingMeMessageBuilders.length === 0) {
        const reply =
          type === PING_LIST.type.own ?
            "You didn't register any pings yet."
          : 'There are no pings registered for this server.';

        await defer;
        await interaction.editReply(reply);
        return;
      }

      const pingForPingListMessageBuilder = new PingForPingListMessageBuilder(
        interaction,
        pingForPingMeMessageBuilders,
        timezone
      );
      pingForPingMeMessageBuilders.forEach((builder: Readonly<PingForPingMeMessageBuilder>) => {
        builder.registerPing(pingsDatabase);
      });
      const reply = pingForPingListMessageBuilder.first();
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(pingForPingListMessageBuilders, pingForPingListMessageBuilder);
    } catch (error) {
      logError(error, 'Error at pingListHandler');

      await defer;
      await interaction.editReply('Failed to show ping list.');
    }
  };
}
