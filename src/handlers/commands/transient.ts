import { setTimeout } from 'node:timers/promises';

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { getOptionValue } from '../../discord/get-option-value.ts';
import { logError } from '../../utils/log-error.ts';

const MAXIMUM_DURATION_SECONDS = 600 as const;

export function transientHandler() {
  return async function transientHandlerInnerFunction(
    interaction: ChatInputCommandInteraction
  ): Promise<undefined> {
    try {
      const attachment = interaction.options.get('attachment')?.attachment;
      const text = getOptionValue(interaction, 'text');
      const duration = getOptionValue(interaction, 'duration', Number) ?? 3;

      if (text !== undefined && attachment !== undefined) {
        await interaction.reply({
          content: 'Please only provide either attachment or text.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (text === undefined && attachment === undefined) {
        await interaction.reply({
          content: 'Please provide either attachment or text.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (!Number.isFinite(duration) || duration < 0 || duration > MAXIMUM_DURATION_SECONDS) {
        await interaction.reply({
          content: `Please provide a duration between 0 and ${MAXIMUM_DURATION_SECONDS}.`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      let reply = text;
      if (attachment !== undefined) reply = attachment.url;
      if (reply === undefined)
        throw new Error('Either text or attachment must have been not undefined.');

      await interaction.reply(reply);
      await setTimeout(duration * 1000);
      await interaction.deleteReply();
    } catch (error: unknown) {
      logError(error, 'Error at transientHandler');
    }
  };
}
