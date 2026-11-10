import type { ChatInputCommandInteraction } from 'discord.js';

import { botgeConfig } from '../../config/botge-config.ts';
import type { AddedEmotesDatabase } from '../../database/added-emotes-database.ts';
import { getOptionValue, getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import type { Guild } from '../../discord/guild.ts';
import { addSevenTVEmote, canAddEmote } from '../../emotes/add-emote.ts';
import { logError } from '../../utils/log-error.ts';

export function addEmoteHandler(addedEmotesDatabase: Readonly<AddedEmotesDatabase>) {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild>
  ): Promise<void> => {
    const defer = interaction.deferReply();
    try {
      if (!botgeConfig.general.use7TVAddedEmotes) {
        await defer;
        await interaction.editReply('Added 7TV emotes are disabled by the operator.');
        return;
      }
      const { member } = interaction;
      const interactionGuild = interaction.guild;
      if (interactionGuild === null || member === null) return;

      const guildMember = await interactionGuild.members.fetch(interaction.user.id);
      if (!canAddEmote(guild, interactionGuild, guildMember, [...guildMember.roles.cache])) {
        await defer;
        await interaction.editReply(
          'You do not have the necessary permissions to use this command.'
        );
        return;
      }

      const url = getOptionValueWithoutUndefined(interaction, 'url');
      const name = getOptionValue(interaction, 'name') ?? null;
      const result = await addSevenTVEmote(addedEmotesDatabase, guild, url, name);
      await defer;
      await interaction.editReply(result.message);
    } catch (error) {
      logError(error, 'Error at addEmoteHandlerSevenNotInSet');

      await defer;
      await interaction.editReply('Failed to add emote.');
    }
  };
}
