import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';

import { registerMessageBuilder } from '../../bot/message-builder-manager.ts';
import { getOptionValue } from '../../discord/get-option-value.ts';
import type { Guild } from '../../discord/guild.ts';
import { TwitchClipMessageBuilder } from '../../message-builders/twitch-clip-message-builder.ts';
import type { MutableArray, TwitchClip } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';

function shuffle(array: MutableArray<TwitchClip>): void {
  let currentIndex = array.length;
  while (currentIndex !== 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    const current = array[currentIndex];
    const random = array[randomIndex];
    if (current === undefined || random === undefined)
      throw new Error('Cannot shuffle missing clips.');
    [array[currentIndex], array[randomIndex]] = [random, current];
  }
}

const CLEANUP_MINUTES = 10 as const;
const MAX_TWITCH_CLIP_MESSAGE_BUILDERS_LENGTH = 15 as const;

export function clipHandler(
  twitchClipMessageBuilders: MutableArray<Readonly<TwitchClipMessageBuilder>>
) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    const ephemeral = getOptionValue(interaction, 'ephemeral', Boolean) ?? false;
    if (ephemeral && interaction.guild === null) {
      await interaction.reply({
        content: 'Ephemeral cannot be used in DMs.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { twitchClipsMeilisearchIndex } = guild;
    if (twitchClipsMeilisearchIndex === undefined) {
      await interaction.reply('clip command is not available in this server.');
      return;
    }
    if (twitchClipMessageBuilders.length >= MAX_TWITCH_CLIP_MESSAGE_BUILDERS_LENGTH) {
      await interaction.reply(
        `${twitchClipMessageBuilders.length} clip commands are currently in use. Please wait at most ${CLEANUP_MINUTES} minutes.`
      );
      return;
    }

    const defer =
      ephemeral ?
        interaction.deferReply({ flags: MessageFlags.Ephemeral })
      : interaction.deferReply();
    try {
      const title = getOptionValue(interaction, 'title')?.toLowerCase();
      const clipper = getOptionValue(interaction, 'clipper');
      const category = getOptionValue(interaction, 'category');
      const sortBy = getOptionValue(interaction, 'sortby');
      const sortByField = ((): string => {
        if (sortBy === 'views') return 'view_count:desc';
        else if (sortBy === 'shuffle') return sortBy;
        return 'created_at:desc';
      })();

      const filter = ((): string => {
        const filters: string[] = [];
        const clipperFilter =
          clipper !== undefined ? `creator_name = ${JSON.stringify(clipper)}` : undefined;
        const gameFilter =
          category !== undefined ? `game_id = ${JSON.stringify(category)}` : undefined;

        if (clipperFilter !== undefined) filters.push(clipperFilter);
        if (gameFilter !== undefined) filters.push(gameFilter);

        return filters.join(' AND ');
      })();

      const { maxTotalHits } = await twitchClipsMeilisearchIndex.getPagination();
      if (maxTotalHits === null || maxTotalHits === undefined)
        throw new Error('pagination max total hits not set');

      const search = await twitchClipsMeilisearchIndex.search<TwitchClip>(title ?? null, {
        filter: filter,
        matchingStrategy: 'all',
        sort: sortByField !== 'shuffle' ? [sortByField] : [],
        limit: maxTotalHits
      });
      const hits: TwitchClip[] = search.hits;
      if (sortByField === 'shuffle') shuffle(hits);

      const [hit] = hits;
      if (hit === undefined) {
        await defer;
        await interaction.editReply('Could not find clip.');
        return;
      } else if (hits.length === 1) {
        const embedServer = process.env['EMBED_SERVER_TWITCH']?.trim();
        const reply =
          embedServer !== undefined && embedServer !== '' ?
            `${embedServer.replace(/\/$/u, '')}/${hit.id}`
          : hit.url;

        await defer;
        await interaction.editReply(reply);
        return;
      }

      const twitchClipMessageBuilder = new TwitchClipMessageBuilder(interaction, hits, ephemeral);
      const reply = twitchClipMessageBuilder.first();
      await defer;

      if (reply === undefined) return;
      await interaction.editReply(reply);
      registerMessageBuilder(twitchClipMessageBuilders, twitchClipMessageBuilder);
    } catch (error) {
      logError(error, 'Error at clipHandler');

      await defer;
      await interaction.editReply('Failed to get clip.');
    }
  };
}
