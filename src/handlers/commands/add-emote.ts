import type { ChatInputCommandInteraction, Role } from 'discord.js';

import { botgeConfig } from '../../config/botge-config.ts';
import type { AddedEmotesDatabase } from '../../database/added-emotes-database.ts';
import { getOptionValue, getOptionValueWithoutUndefined } from '../../discord/get-option-value.ts';
import type { Guild } from '../../discord/guild.ts';
import { globalAdministrator, owner, permitted } from '../../discord/permissions.ts';
import { SEVEN_TV_EMOTES_URL, sevenTVUrlToSevenTVNotInSet } from '../../emotes/provider-urls.ts';
import type { AddedEmote } from '../../types.ts';
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
      const memberRolesCache: readonly (readonly [string, Role])[] = [...guildMember.roles.cache];
      if (
        !guild.allowEveryoneToAddEmote
        && !permitted(memberRolesCache, guild.addEmotePermittedRoleIds)
        && !owner(guildMember, interactionGuild)
        && !globalAdministrator(guildMember)
      ) {
        await defer;
        await interaction.editReply(
          'You do not have the necessary permissions to use this command.'
        );
        return;
      }

      const url = getOptionValueWithoutUndefined(interaction, 'url');
      const name = getOptionValue(interaction, 'name') ?? null;

      const sourceEmote = await sevenTVUrlToSevenTVNotInSet(url);
      if (sourceEmote === undefined) {
        await defer;
        await interaction.editReply('Invalid URL.');

        return;
      }

      if (guild.emoteCatalog.matchSingleExact(name ?? sourceEmote.name)) {
        await defer;
        await interaction.editReply('There is already an emote with the same name.');

        return;
      }

      const emoteId = sourceEmote.id;
      const addedEmote: AddedEmote = { url: `${SEVEN_TV_EMOTES_URL}/${emoteId}`, alias: name };
      const addedEmotes = addedEmotesDatabase.getAll(guild.id);
      if (addedEmotes.some((existingEmote) => existingEmote.url === addedEmote.url)) {
        await defer;
        await interaction.editReply('There is already an emote with the same URL.');

        return;
      }

      addedEmotesDatabase.insert(addedEmote, guild.id);

      const sevenTVEmoteNotInSet = { ...sourceEmote, name: name ?? sourceEmote.name };
      guild.personalEmoteStore.addSevenTVEmoteNotInSet(sevenTVEmoteNotInSet);

      await defer;
      await interaction.editReply(
        `Added emote ${sourceEmote.name}${name !== null ? ` with the name ${name}` : ''}.`
      );
    } catch (error) {
      logError(error, 'Error at addEmoteHandlerSevenNotInSet');

      await defer;
      await interaction.editReply('Failed to add emote.');
    }
  };
}
