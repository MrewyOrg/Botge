import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  RoleSelectMenuInteraction
} from 'discord.js';

import type { Guild } from '../../discord/guild.ts';
import { globalAdministrator, owner, permitted } from '../../discord/permissions.ts';

/** Recheck current permissions when a component is submitted, including stale settings menus. */
export async function canManageSettings(
  interaction: ButtonInteraction | ModalSubmitInteraction | RoleSelectMenuInteraction,
  guild: Readonly<Guild>,
  ownerOnly = false
): Promise<boolean> {
  if (interaction.guild === null || interaction.guildId !== guild.id) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return (
    owner(member, interaction.guild)
    || globalAdministrator(member)
    || (!ownerOnly && permitted([...member.roles.cache], guild.settingsPermittedRoleIds))
  );
}
