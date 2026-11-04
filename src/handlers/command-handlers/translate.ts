/** @format */

import type { ChatInputCommandInteraction } from 'discord.js';

import { getOptionValueWithoutUndefined } from '../../utils/public/get-option-value.ts';
import { logError } from '../../utils/public/log-error.ts';
import type { ReadonlyDeepLClient } from '../../types.ts';
import type { Guild } from '../../modules/discord/guild.ts';

export function translateHandler(deepLClient: ReadonlyDeepLClient | undefined) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    if (deepLClient === undefined) {
      void interaction.reply('Translate command is not available right now.');
      return;
    }

    const defer = interaction.deferReply();
    try {
      const text = getOptionValueWithoutUndefined<string>(interaction, 'text');

      const textResult = await deepLClient.translateText(text, null, 'en-US', {
        modelType: 'prefer_quality_optimized',
        formality: 'default'
      });

      await defer;
      await interaction.editReply(textResult.text);
    } catch (error: unknown) {
      logError(error, 'Error at translateHandler');

      await defer;
      await interaction.editReply('Failed to translate.');
    }
  };
}
