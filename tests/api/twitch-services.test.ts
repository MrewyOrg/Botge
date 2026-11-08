import { type Index, type Meilisearch, MeilisearchApiError } from 'meilisearch';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { listCutedogClipIds } from 'src/api/twitch/list-cutedog-clip-ids.ts';
import {
  getClipsWithGameNameFromBroadcasterName,
  getClipsWithGameNameFromIds
} from 'src/api/twitch/twitch-api-utils.ts';
import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import { TwitchClipsMeilisearch } from 'src/api/twitch/twitch-clips-meilisearch.ts';
import type { TwitchClip } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function missingIndex(): MeilisearchApiError {
  return new MeilisearchApiError(new Response(null, { status: 404 }), {
    code: 'index_not_found',
    message: 'Not found',
    type: 'invalid_request',
    link: 'https://example.com'
  });
}

test('existing search indexes are reused and concurrent calls share initialization', async () => {
  const updateSettings = vi.fn(() => ({ waitTask: vi.fn().mockResolvedValue(undefined) }));
  const index = { updateSettings } as unknown as Index;
  const getIndex = vi.fn().mockResolvedValue(index);
  const createIndex = vi.fn();
  const service = new TwitchClipsMeilisearch({ getIndex, createIndex });
  const results = await Promise.all([
    service.getOrCreateIndex('guild'),
    service.getOrCreateIndex('guild')
  ]);
  expect(results).toEqual([index, index]);
  expect(getIndex).toHaveBeenCalledOnce();
  expect(createIndex).not.toHaveBeenCalled();
  expect(updateSettings).toHaveBeenCalledOnce();
});

test('missing search indexes are created, while unrelated errors are preserved and retryable', async () => {
  const index = {
    updateSettings: () => ({ waitTask: vi.fn().mockResolvedValue(undefined) })
  } as unknown as Index;
  const getIndex = vi.fn().mockRejectedValueOnce(missingIndex()).mockResolvedValueOnce(index);
  const createIndex = vi.fn(() => ({ waitTask: vi.fn().mockResolvedValue(undefined) }));
  const service = new TwitchClipsMeilisearch({ getIndex, createIndex } as unknown as Meilisearch);
  expect(await service.getOrCreateIndex('guild')).toBe(index);
  expect(createIndex).toHaveBeenCalledWith('twitchClips_guild', { primaryKey: 'id' });
  getIndex.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(index);
  await expect(service.getOrCreateIndex('other')).rejects.toThrow('Offline');
  expect(await service.getOrCreateIndex('other')).toBe(index);
  expect(createIndex).toHaveBeenCalledOnce();
});

test('clip helpers preserve timestamps and resolve only nonempty game IDs', async () => {
  const clip: TwitchClip = {
    id: 'clip',
    game_id: 'game',
    created_at: '2026-11-07T12:34:56Z',
    title: 'Clip',
    url: 'https://clips.twitch.tv/clip',
    creator_name: 'Creator',
    view_count: 1,
    thumbnail_url: 'https://example.com/clip.jpg'
  };
  const games = vi.fn().mockResolvedValue({ data: [{ id: 'game', name: 'Game' }] });
  const api = {
    games,
    clipsFromIds: vi
      .fn()
      .mockResolvedValue({ data: [clip, { ...clip, id: 'other', game_id: '' }], pagination: {} })
  } as unknown as Readonly<TwitchApi>;
  const result = await getClipsWithGameNameFromIds(api, ['clip', 'other']);
  expect(result[0]).toMatchObject({ game_id: 'Game', created_at: clip.created_at });
  expect(requireValue(result[1], 'Expected indexed test value.').game_id).toBe('');
  expect(games).toHaveBeenCalledWith(new Set(['game']));
});

test('unknown Twitch broadcasters produce a clear error without requesting clips', async () => {
  const clipsFromBroadcasterId = vi.fn();
  const api = {
    users: vi.fn().mockResolvedValue({ data: [] }),
    clipsFromBroadcasterId
  } as unknown as Readonly<TwitchApi>;
  await expect(getClipsWithGameNameFromBroadcasterName(api, 'missing')).rejects.toThrow(
    'Twitch broadcaster not found.'
  );
  expect(clipsFromBroadcasterId).not.toHaveBeenCalled();
});

test('curated clip IDs are deduplicated and HTTP errors are not parsed as spreadsheets', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        'https://clips.twitch.tv/One https://clips.twitch.tv/One https://www.twitch.tv/cutedog_/clip/Two'
      )
    );
  vi.stubGlobal('fetch', fetchMock);
  expect(await listCutedogClipIds()).toEqual(['One', 'Two']);
  fetchMock.mockResolvedValueOnce(new Response('error page', { status: 503 }));
  await expect(listCutedogClipIds()).rejects.toMatchObject({ status: 503 });
});

test('broadcaster clips without categories do not request game metadata', async () => {
  const games = vi.fn();
  const clipsFromBroadcasterId = vi
    .fn()
    .mockResolvedValue({ data: [], pagination: { cursor: 'next' } });
  const api = {
    users: vi.fn().mockResolvedValue({ data: [{ id: 'broadcaster' }] }),
    clipsFromBroadcasterId,
    games
  } as unknown as Readonly<TwitchApi>;
  expect(await getClipsWithGameNameFromBroadcasterName(api, 'streamer', 'before')).toEqual([
    [],
    'next'
  ]);
  expect(games).not.toHaveBeenCalled();
  expect(clipsFromBroadcasterId).toHaveBeenCalledWith('broadcaster', 'before');
});

test.each(['race', 'offline', 'forbidden'])(
  'index creation handles %s failures appropriately',
  async (kind) => {
    const index = {
      updateSettings: () => ({ waitTask: vi.fn().mockResolvedValue(undefined) })
    } as unknown as Index;
    const error =
      kind === 'offline' ?
        new Error('offline')
      : new MeilisearchApiError(new Response(null, { status: 400 }), {
          code: kind === 'race' ? 'index_already_exists' : 'permission_denied',
          message: kind,
          type: 'invalid_request',
          link: 'https://example.com'
        });
    const service = new TwitchClipsMeilisearch({
      getIndex: vi.fn().mockRejectedValueOnce(missingIndex()).mockResolvedValue(index),
      createIndex: vi.fn(() => ({ waitTask: vi.fn().mockRejectedValue(error) }))
    } as unknown as Meilisearch);
    if (kind === 'race') expect(await service.getOrCreateIndex('guild')).toBe(index);
    else await expect(service.getOrCreateIndex('guild')).rejects.toBe(error);
  }
);

test('departed guilds release their cached SDK index without deleting stored documents', async () => {
  const index = {
    updateSettings: (): Readonly<{ waitTask: () => Promise<void> }> => ({
      waitTask: async (): Promise<void> => Promise.resolve()
    })
  } as unknown as Index;
  const getIndex = vi.fn().mockResolvedValue(index);
  const service = new TwitchClipsMeilisearch({ getIndex, createIndex: vi.fn() });
  await service.getOrCreateIndex('guild');
  service.releaseIndex('guild');
  await service.getOrCreateIndex('guild');
  expect(getIndex).toHaveBeenCalledTimes(2);
});
