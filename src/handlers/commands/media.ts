import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import type { MediaDatabase } from '../../database/media-database.ts';
import { getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import { GUILD_ID_CUTEDOG } from '../../discord/guild.ts';
import { logError } from '../../utils/log-error.ts';

export function mediaHandler(mediaDatabase: Readonly<MediaDatabase>) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    try {
      const name = getOptionValueWithoutUndefined(interaction, 'name');
      const mediaUrl = ((): string | undefined => {
        const savedUrl = mediaDatabase.getMediaUrl(interaction.user.id, name);
        if (savedUrl !== undefined) return savedUrl;

        return mediaDatabase.getMediaUrl(interaction.user.id, name.toLowerCase());
      })();

      const mediaNotFoundReply =
        interaction.guildId === GUILD_ID_CUTEDOG ? 'jij' : 'Media not found.';

      if (mediaUrl === undefined) {
        await interaction.reply({ content: mediaNotFoundReply, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply(mediaUrl);
    } catch (error) {
      logError(error, 'Error at mediaHandler');

      await interaction.reply({
        content: 'Something went wrong. Please try again later.',
        flags: MessageFlags.Ephemeral
      });
    }
  };
}
