import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import type { QuotesDatabase } from '../../database/quotes-database.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import { QuoteMessageBuilder } from '../../message-builders/quote-message-builder.ts';
import type { MutableArray, Quote } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function quoteListHandler(
  quoteDatabase: Readonly<QuotesDatabase>,
  quoteMessageBuilders: MutableArray<Readonly<QuoteMessageBuilder>>
) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sortBy = getOptionValue(interaction, 'sortby');
      const userId = interaction.user.id;
      const quotes = ((): readonly Quote[] => {
        const storedQuotes = quoteDatabase.getAllQuote(userId);

        if (sortBy === 'alphabetical')
          return [...storedQuotes].sort((a, b) => a.name.localeCompare(b.name));
        return storedQuotes;
      })();

      if (quotes.length === 0) {
        await defer;
        await interaction.editReply('You do not have any quote added.');
        return;
      }

      const quoteMessageBuilder = new QuoteMessageBuilder(interaction, quotes, sortBy);

      const reply = quoteMessageBuilder.first();
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(quoteMessageBuilders, quoteMessageBuilder);
    } catch (error) {
      logError(error, 'Error at quoteListHandler');

      await defer;
      await interaction.editReply('Failed to show quote list.');
    }
  };
}
