import type { ChatInputCommandInteraction } from 'discord.js';

import { getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import type { ReadonlyDeepLClient } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function translateHandler(deepLClient: ReadonlyDeepLClient | undefined) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    if (deepLClient === undefined) {
      await interaction.reply('Translate command is not available right now.');
      return;
    }

    const defer = interaction.deferReply();
    try {
      const text = getOptionValueWithoutUndefined(interaction, 'text');

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
