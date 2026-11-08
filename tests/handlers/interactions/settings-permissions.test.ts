import type { ButtonInteraction } from 'discord.js';
import { expect, test, vi } from 'vitest';

import type { Guild } from 'src/discord/guild.ts';
import { canManageSettings } from 'src/handlers/interactions/settings-permissions.ts';

test('settings submissions recheck roles and respect owner-only actions and guild boundaries', async () => {
  const member = {
    user: { id: 'user', username: 'member' },
    roles: { cache: new Map([['role', {}]]) }
  };
  const fetch = vi.fn().mockResolvedValue(member);
  const interaction = {
    guildId: 'guild',
    user: { id: 'user' },
    guild: { ownerId: 'owner', members: { fetch } }
  } as unknown as ButtonInteraction;
  const guild = { id: 'guild', settingsPermittedRoleIds: ['role'] } as unknown as Readonly<Guild>;
  expect(await canManageSettings(interaction, guild)).toBe(true);
  expect(await canManageSettings(interaction, guild, true)).toBe(false);
  expect(await canManageSettings(interaction, { ...guild, id: 'other' })).toBe(false);
});

test.each([
  { ownerId: 'user', roles: [], permittedRoles: null, ownerOnly: true, expected: true },
  { ownerId: 'owner', roles: [], permittedRoles: ['role'], ownerOnly: false, expected: false },
  { ownerId: 'owner', roles: ['role'], permittedRoles: null, ownerOnly: false, expected: false },
  { ownerId: 'owner', roles: ['role'], permittedRoles: [], ownerOnly: false, expected: false },
  { ownerId: 'owner', roles: ['role'], permittedRoles: ['role'], ownerOnly: true, expected: false }
])(
  'settings authorization uses current ownership and roles: %#',
  async ({
    ownerId,
    roles,
    permittedRoles,
    ownerOnly,
    expected
  }: Readonly<{
    ownerId: string;
    roles: readonly string[];
    permittedRoles: readonly string[] | null;
    ownerOnly: boolean;
    expected: boolean;
  }>) => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        user: { id: 'user', username: 'ordinary-member' },
        roles: { cache: new Map(roles.map((id) => [id, {}])) }
      });
    const interaction = {
      user: { id: 'user' },
      guildId: 'guild',
      guild: { ownerId, members: { fetch } }
    } as unknown as ButtonInteraction;
    const guild = {
      id: 'guild',
      settingsPermittedRoleIds: permittedRoles
    } as unknown as Readonly<Guild>;
    expect(await canManageSettings(interaction, guild, ownerOnly)).toBe(expected);
    expect(fetch).toHaveBeenCalledWith('user');
  }
);

test('direct messages cannot authorize guild settings', async () => {
  const interaction = { guild: null } as unknown as ButtonInteraction;
  const guild = { id: 'guild' } as Readonly<Guild>;
  expect(await canManageSettings(interaction, guild)).toBe(false);
});

test('member lookup failures do not authorize a settings change', async () => {
  const error = new Error('Member left the guild');
  const interaction = {
    user: { id: 'user' },
    guildId: 'guild',
    guild: { members: { fetch: vi.fn().mockRejectedValue(error) } }
  } as unknown as ButtonInteraction;
  await expect(canManageSettings(interaction, { id: 'guild' } as Readonly<Guild>)).rejects.toBe(
    error
  );
});
