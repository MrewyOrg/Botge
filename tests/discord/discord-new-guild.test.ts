import type { Index } from 'meilisearch';
import { afterEach, expect, test, vi } from 'vitest';

import type { ApiManager } from 'src/bot/api-manager.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { newGuild } from 'src/discord/new-guild.ts';
import type { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import { PersonalEmoteStore } from 'src/emotes/emote-store.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('guild creation observes matcher and search initialization together and restores permissions', async () => {
  const pending = Promise.withResolvers<Readonly<PersonalEmoteStore>>();
  const create = vi.spyOn(PersonalEmoteStore, 'create').mockReturnValue(pending.promise);
  const index = {} as Index;
  const getOrCreateIndex = vi.fn().mockResolvedValue(index);
  const createRoles = vi.fn();
  const createEmotes = vi.fn();
  const databaseManager = {
    permittedRoleIdsDatabase: {
      createTable: createRoles,
      getSettingsPermittedRoleIds: () => ['settings'],
      getAddEmotePermittedRoleIds: () => ['emotes'],
      getAddEmotePermitNoRole: () => true
    },
    addedEmotesDatabase: { createTable: createEmotes }
  } as unknown as Readonly<DatabaseManager>;
  const apiManager = {
    twitchClipsMeilisearch: { getOrCreateIndex }
  } as unknown as Readonly<ApiManager>;
  const result = newGuild('guild', null, undefined, databaseManager, apiManager);
  expect(create).toHaveBeenCalledWith('guild', undefined);
  expect(getOrCreateIndex).toHaveBeenCalledWith('guild');
  const matcher = {} as Readonly<EmoteCatalog>;
  pending.resolve({ catalog: matcher } as unknown as Readonly<PersonalEmoteStore>);
  const guild = await result;
  expect(createRoles).toHaveBeenCalledWith('guild');
  expect(createEmotes).toHaveBeenCalledWith('guild');
  expect(guild.emoteCatalog).toBe(matcher);
  expect(guild.twitchClipsMeilisearchIndex).toBe(index);
  expect(guild.settingsPermittedRoleIds).toEqual(['settings']);
  expect(guild.addEmotePermittedRoleIds).toEqual(['emotes']);
  expect(guild.allowEveryoneToAddEmote).toBe(true);
});

test('failed search initialization releases the new emote subscriptions', async () => {
  const dispose = vi.fn();
  vi.spyOn(PersonalEmoteStore, 'create').mockResolvedValue({
    dispose
  } as unknown as Readonly<PersonalEmoteStore>);
  const databaseManager = {
    permittedRoleIdsDatabase: {
      createTable: vi.fn(),
      getSettingsPermittedRoleIds: () => null,
      getAddEmotePermittedRoleIds: () => null,
      getAddEmotePermitNoRole: () => false
    },
    addedEmotesDatabase: { createTable: vi.fn() }
  } as unknown as Readonly<DatabaseManager>;
  const apiManager = {
    twitchClipsMeilisearch: {
      getOrCreateIndex: vi.fn().mockRejectedValue(new Error('search unavailable'))
    }
  } as unknown as Readonly<ApiManager>;
  await expect(newGuild('guild', null, undefined, databaseManager, apiManager)).rejects.toThrow(
    'search unavailable'
  );
  expect(dispose).toHaveBeenCalledOnce();
});

test('emote initialization failures abort guild creation', async () => {
  const failure = new Error('emotes unavailable');
  vi.spyOn(PersonalEmoteStore, 'create').mockRejectedValueOnce(failure);
  const database = {
    permittedRoleIdsDatabase: {
      createTable: vi.fn(),
      getSettingsPermittedRoleIds: vi.fn(),
      getAddEmotePermittedRoleIds: vi.fn(),
      getAddEmotePermitNoRole: vi.fn()
    },
    addedEmotesDatabase: { createTable: vi.fn() }
  } as unknown as DatabaseManager;
  await expect(newGuild('guild', null, undefined, database, {} as ApiManager)).rejects.toBe(
    failure
  );
});
