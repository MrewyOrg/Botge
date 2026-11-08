import type { ChatInputCommandInteraction, GuildEmoji } from 'discord.js';

import { getOptionValue } from '../../discord/get-option-value.ts';
import { logError } from '../../utils/log-error.ts';

const DEFAULT_SIZE = 5 as const;

export function findTheEmojiHandler() {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const defer = interaction.deferReply();
    try {
      const emoji = getOptionValue(interaction, 'emoji');
      const size = getOptionValue(interaction, 'size', Number) ?? DEFAULT_SIZE;

      if (!Number.isInteger(size)) {
        await defer;
        await interaction.editReply('Size must be a whole number.');
        return;
      }
      if (size < 3) {
        await defer;
        await interaction.editReply('Size must be at least 3.');
        return;
      } else if (size > 7) {
        await defer;
        await interaction.editReply('Size must be at most 7.');
        return;
      }

      const interactionGuild = interaction.guild;
      if (interactionGuild === null) {
        await defer;
        await interaction.editReply('The bot must be in a server for this command to work.');
        return;
      }

      const emojiArray: readonly string[] = Array.from(
        (await (await interactionGuild.fetch()).emojis.fetch()).entries()
      )
        .filter(
          (
            candidateEmoji: readonly [
              string,
              Readonly<Pick<GuildEmoji, 'id' | 'name' | 'animated'>>
            ]
          ) => !candidateEmoji[1].animated
        )
        .map(
          (
            candidateEmoji: readonly [
              string,
              Readonly<Pick<GuildEmoji, 'id' | 'name' | 'animated'>>
            ]
          ) => `<:${candidateEmoji[1].name}:${candidateEmoji[0]}>`
        );

      if (emojiArray.length < 2) {
        await defer;
        await interaction.editReply('Must have at least 2 non-animated emojis in the server.');
        return;
      }
      if (emoji !== undefined && !emojiArray.some((candidateEmoji) => emoji === candidateEmoji)) {
        await defer;
        await interaction.editReply('Emoji must be from this server.');
        return;
      }

      const findTheEmoji = emoji ?? emojiArray[Math.floor(Math.random() * emojiArray.length)];

      const otherEmojis = emojiArray.filter((candidate) => candidate !== findTheEmoji);

      const alignment = ((): string => {
        switch (size) {
          case 3:
            return '               ';
          case 4:
            return '            ';
          case 5:
            return '          ';
          case 6:
            return '      ';
          case 7:
            return '   ';
          default:
            return '';
        }
      })();

      const reply = ((): string => {
        let gridContent = `⬇️ Find the emoji: ${findTheEmoji} ⬇️`;
        gridContent += `\n${alignment}`;

        const findTheEmojiPosition = Math.floor(Math.random() * size * size) + 1;
        for (let i = 1; i <= size * size; i++) {
          if (i !== findTheEmojiPosition) {
            const randomEmoji = otherEmojis[Math.floor(Math.random() * otherEmojis.length)];

            gridContent += `||${randomEmoji}||`;
          } else {
            gridContent += `||${findTheEmoji}||`;
          }

          if (i % size === 0) gridContent += `\n${alignment}`;
        }

        return gridContent.trim();
      })();

      await defer;
      await interaction.editReply(reply);
    } catch (error) {
      logError(error, 'Error at findTheEmojiHandler');

      await defer;
      await interaction.editReply('Failed to generate the find the emoji grid.');
    }
  };
}
