import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { resolveTenorMedia } from '../../api/tenor/resolve-media.ts';
import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import type { MediaDatabase } from '../../database/media-database.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import { MediaMessageBuilder } from '../../message-builders/media-message-builder.ts';
import type { Media, MutableArray } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

export function mediaListHandler(
  mediaDatabase: Readonly<MediaDatabase>,
  mediaMessageBuilders: MutableArray<Readonly<MediaMessageBuilder>>
) {
  return async (interaction: ChatInputCommandInteraction): Promise<void> => {
    const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const sortBy = getOptionValue(interaction, 'sortby');
      const userId = interaction.user.id;
      const allMedia = ((): readonly Media[] => {
        const storedMedia = mediaDatabase.getAllMedia(userId);

        if (sortBy === 'alphabetical')
          return [...storedMedia].sort((a, b) => a.name.localeCompare(b.name));
        return storedMedia;
      })();

      if (allMedia.length === 0) {
        await defer;
        await interaction.editReply('You do not have any media added.');
        return;
      }

      const mediaMessageBuilder = new MediaMessageBuilder(
        interaction,
        await resolveTenorMedia(allMedia),
        sortBy
      );

      const reply = mediaMessageBuilder.first();
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(mediaMessageBuilders, mediaMessageBuilder);
    } catch (error) {
      logError(error, 'Error at mediaListHandler');

      await defer;
      await interaction.editReply('Failed to show media list.');
    }
  };
}
