import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { beforeEach, expect, test, vi } from 'vitest';

import type { Guild } from 'src/discord/guild.ts';
import { globalAdministrator, owner, permitted } from 'src/discord/permissions.ts';
import { settingsHandler } from 'src/handlers/commands/settings.ts';

vi.mock('src/discord/permissions.ts', () => ({
  globalAdministrator: vi.fn(),
  owner: vi.fn(),
  permitted: vi.fn()
}));
beforeEach(() => {
  vi.resetAllMocks();
});

test.each(['owner', 'administrator', 'role', 'none', 'direct'])(
  'settings expose only authorized controls: %s',
  async (permission) => {
    vi.mocked(owner).mockReturnValue(permission === 'owner');
    vi.mocked(globalAdministrator).mockReturnValue(permission === 'administrator');
    vi.mocked(permitted).mockReturnValue(permission === 'role');
    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const interaction = {
      member: {},
      user: { id: 'owner' },
      guild:
        permission === 'direct' ? null : (
          { members: { fetch: vi.fn().mockResolvedValue({ roles: { cache: new Map() } }) } }
        ),
      editReply,
      deferReply
    } as unknown as ChatInputCommandInteraction;
    await settingsHandler()(interaction, {
      settingsPermittedRoleIds: null,
      allowEveryoneToAddEmote: false
    } as Readonly<Guild>);
    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const payload: unknown = editReply.mock.calls[0]?.[0];
    expect(payload).toHaveProperty(
      'components.length',
      permission === 'none' || permission === 'direct' ? 1 : 2
    );
    if (permission !== 'none' && permission !== 'direct')
      expect(payload).toHaveProperty(
        'components.0.components.length',
        permission === 'role' ? 3 : 5
      );
  }
);
