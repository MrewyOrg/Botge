import type { GuildMember, Role } from 'discord.js';
import type { Index } from 'meilisearch';
import { beforeEach, expect, test, vi } from 'vitest';

import { getClipMetadata, refreshClipIndex } from 'src/api/twitch/clip-index.ts';
import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import { Guild } from 'src/discord/guild.ts';
import { globalAdministrator, owner, permitted } from 'src/discord/permissions.ts';
import { User } from 'src/discord/user.ts';
import type { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import type { PersonalEmoteStore } from 'src/emotes/emote-store.ts';

vi.mock('src/api/twitch/clip-index.ts', () => ({
  refreshClipIndex: vi.fn(),
  getClipMetadata: vi.fn()
}));

function guild(roles: readonly string[] = []): Guild {
  return new Guild(
    'guild',
    'streamer',
    {} as Index,
    {} as Readonly<EmoteCatalog>,
    {} as Readonly<PersonalEmoteStore>,
    roles,
    roles,
    false
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getClipMetadata).mockResolvedValue({ creatorNames: ['creator'], gameIds: ['game'] });
});

test('guild role lists normalize empty values and do not retain mutable caller arrays', () => {
  const roles = ['role'];
  const model = guild(roles);
  roles.push('unwanted');
  expect(model.settingsPermittedRoleIds).toEqual(['role']);
  const changed = ['new'];
  model.changeAddEmotePermittedRoleIds(changed);
  changed.length = 0;
  expect(model.addEmotePermittedRoleIds).toEqual(['new']);
  model.changeSettingsPermittedRoleIds([]);
  model.changeAddEmotePermittedRoleIds([]);
  expect(model.settingsPermittedRoleIds).toBeNull();
  expect(model.addEmotePermittedRoleIds).toBeNull();
});

test('failed metadata refresh preserves the previously published lists', async () => {
  const model = guild();
  await model.refreshUniqueCreatorNamesAndGameIds();
  vi.mocked(getClipMetadata).mockRejectedValueOnce(new Error('Lookup failed'));
  await expect(model.refreshUniqueCreatorNamesAndGameIds()).rejects.toThrow('Lookup failed');
  expect(model.uniqueCreatorNames).toEqual(['creator']);
  expect(model.uniqueGameIds).toEqual(['game']);
});

test('manual and scheduled clip refreshes run serially and recover after failures', async () => {
  const model = guild();
  const api = {} as Readonly<TwitchApi>;
  const pending = Promise.withResolvers<undefined>();
  vi.mocked(refreshClipIndex).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
  const first = model.refreshClips(api);
  const second = model.refreshClips(api);
  await vi.waitFor(() => {
    expect(refreshClipIndex).toHaveBeenCalledOnce();
  });
  pending.resolve(undefined);
  await Promise.all([first, second]);
  expect(refreshClipIndex).toHaveBeenCalledTimes(2);
  vi.mocked(refreshClipIndex)
    .mockRejectedValueOnce(new Error('Refresh failed'))
    .mockResolvedValueOnce(undefined);
  const failed = model.refreshClips(api);
  const recovered = model.refreshClips(api);
  await expect(failed).rejects.toThrow('Refresh failed');
  await recovered;
  expect(refreshClipIndex).toHaveBeenCalledTimes(4);
});

test('users have a default color while preserving an explicitly disabled border', () => {
  const user = new User('user');
  expect(user.emoteBorderColor).toBe('000000');
  user.changeEnableEmoteBorder(false);
  expect(user.enableEmoteBorder).toBe(false);
  user.changeEmoteBorderColor('ffffff');
  expect(user.emoteBorderColor).toBe('ffffff');
});

test('permission checks preserve the existing owner, role, and global-admin policy', () => {
  const roles = [['role', {} as Role]] as const;
  expect(permitted(roles, ['role'])).toBe(true);
  expect(permitted(roles, ['other'])).toBe(false);
  expect(permitted(roles, null)).toBe(false);
  const member = { user: { id: 'owner', username: 'mrewy2' } } as GuildMember;
  expect(owner(member, { ownerId: 'owner' })).toBe(true);
  expect(globalAdministrator(member)).toBe(true);
  expect(globalAdministrator({ user: { username: 'other' } })).toBe(false);
});
