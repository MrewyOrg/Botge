import type { Index } from 'meilisearch';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getClipMetadata, refreshClipIndex } from 'src/api/twitch/clip-index.ts';
import {
  getClipsWithGameNameFromBroadcasterName,
  getClipsWithGameNameFromIds
} from 'src/api/twitch/twitch-api-utils.ts';
import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import type { TwitchClip } from 'src/types.ts';

vi.mock('src/api/twitch/twitch-api-utils.ts', () => ({
  getClipsWithGameNameFromBroadcasterName: vi.fn(),
  getClipsWithGameNameFromIds: vi.fn()
}));

const api = {} as Readonly<TwitchApi>;
function clip(id: string, game = ''): TwitchClip {
  return {
    id,
    url: `https://clips.twitch.tv/${id}`,
    title: id,
    game_id: game,
    creator_name: id,
    created_at: '2026-01-01',
    view_count: 1,
    thumbnail_url: 'https://example.com/image.png'
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Clip indexing', () => {
  test('indexes pages sequentially, handles empty categories, and stops on a repeated cursor', async () => {
    const waitTask = vi.fn().mockResolvedValue(undefined);
    const updateDocuments = vi.fn(() => ({ waitTask }));
    const index = { updateDocuments } as unknown as Index;
    vi.mocked(getClipsWithGameNameFromBroadcasterName)
      .mockResolvedValueOnce([[clip('one')], 'next'])
      .mockResolvedValueOnce([[clip('two', 'Game')], 'next']);
    await refreshClipIndex(index, api, 'streamer');
    expect(getClipsWithGameNameFromBroadcasterName).toHaveBeenCalledTimes(2);
    expect(updateDocuments).toHaveBeenNthCalledWith(1, [{ ...clip('one'), game_id: 'N/A' }]);
    expect(updateDocuments).toHaveBeenNthCalledWith(2, [clip('two', 'Game')]);
    expect(waitTask).toHaveBeenCalledTimes(2);
  });

  test('first-page fetch failure leaves an existing index untouched when replacing clips', async () => {
    const remove = vi.fn();
    const index = { deleteAllDocuments: remove } as unknown as Index;
    vi.mocked(getClipsWithGameNameFromBroadcasterName).mockRejectedValue(
      new Error('Twitch failed')
    );
    await expect(refreshClipIndex(index, api, 'streamer', undefined, true)).rejects.toThrow(
      'Twitch failed'
    );
    expect(remove).not.toHaveBeenCalled();
  });

  test('failed indexing tasks stop pagination immediately', async () => {
    const index = {
      updateDocuments: () => ({ waitTask: vi.fn().mockRejectedValue(new Error('Index failed')) })
    } as unknown as Index;
    vi.mocked(getClipsWithGameNameFromBroadcasterName).mockResolvedValue([[clip('one')], 'next']);
    await expect(refreshClipIndex(index, api, 'streamer')).rejects.toThrow('Index failed');
    expect(getClipsWithGameNameFromBroadcasterName).toHaveBeenCalledOnce();
  });

  test('curated IDs are fetched in Twitch-sized batches', async () => {
    const waitTask = vi.fn().mockResolvedValue(undefined);
    const index = { updateDocuments: () => ({ waitTask }) } as unknown as Index;
    vi.mocked(getClipsWithGameNameFromIds).mockResolvedValue([clip('one')]);
    const ids = Array.from({ length: 101 }, (_, position) => String(position));
    await refreshClipIndex(index, api, 'streamer', ids);
    expect(getClipsWithGameNameFromIds).toHaveBeenNthCalledWith(1, api, ids.slice(0, 100));
    expect(getClipsWithGameNameFromIds).toHaveBeenNthCalledWith(2, api, ids.slice(100));
  });
});

test('metadata reads every page and returns unique creators/categories in newest-first order', async () => {
  const getDocuments = vi
    .fn()
    .mockResolvedValueOnce({
      results: [clip('old', 'Game A'), { ...clip('shared', 'Game B'), created_at: '2026-02-01' }],
      total: 3
    })
    .mockResolvedValueOnce({
      results: [{ ...clip('shared', 'Game A'), created_at: '2026-03-01' }],
      total: 3
    });
  const result = await getClipMetadata({ getDocuments } as unknown as Index);
  expect(result).toEqual({ creatorNames: ['shared', 'old'], gameIds: ['Game A', 'Game B'] });
  expect(getDocuments).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ offset: 0, limit: 1000 })
  );
  expect(getDocuments).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 2 }));
});

test('an explicitly empty replacement clears stale clips without scheduling document updates', async () => {
  const waitTask = vi.fn().mockResolvedValue(undefined);
  const deleteAllDocuments = vi.fn(() => ({ waitTask }));
  const updateDocuments = vi.fn();
  await refreshClipIndex(
    { deleteAllDocuments, updateDocuments } as unknown as Index,
    api,
    'streamer',
    [],
    true
  );
  expect(deleteAllDocuments).toHaveBeenCalledOnce();
  expect(waitTask).toHaveBeenCalledOnce();
  expect(updateDocuments).not.toHaveBeenCalled();
});
test('metadata pagination terminates on an empty page despite an inconsistent total', async () => {
  const getDocuments = vi.fn().mockResolvedValue({ results: [], total: 100 });
  expect(await getClipMetadata({ getDocuments } as unknown as Index)).toEqual({
    creatorNames: [],
    gameIds: []
  });
  expect(getDocuments).toHaveBeenCalledOnce();
});
