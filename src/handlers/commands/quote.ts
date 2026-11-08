import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import type { QuotesDatabase } from '../../database/quotes-database.ts';
import { getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import { GUILD_ID_CUTEDOG } from '../../discord/guild.ts';
import { logError } from '../../utils/log-error.ts';

export function quoteHandler(quoteDatabase: Readonly<QuotesDatabase>) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    try {
      const name = getOptionValueWithoutUndefined(interaction, 'name');
      const quoteContent = ((): string | undefined => {
        const savedContent = quoteDatabase.getQuoteContent(interaction.user.id, name);
        if (savedContent !== undefined) return savedContent;

        return quoteDatabase.getQuoteContent(interaction.user.id, name.toLowerCase());
      })();

      const quoteNotFoundReply =
        interaction.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'Quote not found.';

      if (quoteContent === undefined) {
        await interaction.reply({ content: quoteNotFoundReply, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply(quoteContent);
    } catch (error) {
      logError(error, 'Error at quoteHandler');

      await interaction.reply({
        content: 'Something went wrong. Please try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  };
}
