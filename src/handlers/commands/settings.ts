import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  MessageFlags,
  type Role
} from 'discord.js';

import type { Guild } from '../../discord/guild.ts';
import { globalAdministrator, owner, permitted } from '../../discord/permissions.ts';
import { logError } from '../../utils/log-error.ts';
import { VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID } from '../interactions/component-ids.ts';

export const SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID = 'settingsPermittedRolesButton' as const;
export const ADD_EMOTE_ACCESS_BUTTON_CUSTOM_ID = 'addEmotePermittedRolesButton' as const;
export const ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID =
  'allowEveryoneToAddEmoteButton' as const;
export const ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID = 'addedEmoteDeletionMenuButton' as const;
export const CONFIGURATION_GUILD_BUTTON_CUSTOM_ID = 'configurationGuildButton' as const;
export const CONFIGURATION_USER_BUTTON_CUSTOM_ID = 'configurationUserButton' as const;

export const EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID =
  'borderOnEmotesConfigurationButton' as const;

export function settingsHandler() {
  return async (
    interaction: ChatInputCommandInteraction,
    guild: Readonly<Guild> | undefined
  ): Promise<void> => {
    const defer = interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { member } = interaction;
      const interactionGuild = interaction.guild;

      if (guild === undefined || interactionGuild === null || member === null) {
        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(CONFIGURATION_USER_BUTTON_CUSTOM_ID)
            .setLabel('Choose emote server')
            .setStyle(ButtonStyle.Primary)
        );

        await defer;
        await interaction.editReply({ components: [row] });
        return;
      }

      let guildSettingsRow: ActionRowBuilder<MessageActionRowComponentBuilder> | undefined =
        undefined;

      const guildMember = await interactionGuild.members.fetch(interaction.user.id);
      const memberRolesCache: readonly (readonly [string, Role])[] = [...guildMember.roles.cache];
      const isOwner = owner(guildMember, interactionGuild);
      const isGlobalAdministrator = globalAdministrator(guildMember);

      if (
        permitted(memberRolesCache, guild.settingsPermittedRoleIds)
        || isOwner
        || isGlobalAdministrator
      ) {
        guildSettingsRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

        if (isOwner || isGlobalAdministrator) {
          guildSettingsRow.addComponents(
            new ButtonBuilder()
              .setCustomId(CONFIGURATION_GUILD_BUTTON_CUSTOM_ID)
              .setLabel('Server emotes')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID)
              .setLabel('Settings access')
              .setStyle(ButtonStyle.Secondary)
          );
        }

        guildSettingsRow.addComponents(
          new ButtonBuilder()
            .setCustomId(ADD_EMOTE_ACCESS_BUTTON_CUSTOM_ID)
            .setLabel('Add emote access')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID)
            .setLabel('Manage added emotes')
            .setStyle(ButtonStyle.Secondary)
        );
      }

      const userSettingsRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();

      userSettingsRow.addComponents(
        new ButtonBuilder()
          .setCustomId(EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID)
          .setLabel('My emote borders')
          .setStyle(ButtonStyle.Primary)
      );

      if (guildSettingsRow !== undefined)
        userSettingsRow.addComponents(
          new ButtonBuilder()
            .setCustomId(VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID)
            .setLabel('Bot voice channel')
            .setStyle(ButtonStyle.Secondary)
        );

      await defer;
      await interaction.editReply({
        components:
          guildSettingsRow !== undefined ? [guildSettingsRow, userSettingsRow] : [userSettingsRow]
      });
    } catch (error) {
      logError(error, 'Error at settingsHandler');

      await defer;
      await interaction.editReply('Failed to output settings.');
    }
  };
}
