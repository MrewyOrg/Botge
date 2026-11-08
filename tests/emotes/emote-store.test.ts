import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import type { AddedEmotesDatabase } from 'src/database/added-emotes-database.ts';
import { GlobalEmoteStore, PersonalEmoteStore } from 'src/emotes/emote-store.ts';
import { sevenTVEvents } from 'src/emotes/seventv/event-client.ts';
import type { SevenTVEmoteNotInSet, SevenTVEmotes } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

const standalone: SevenTVEmoteNotInSet = {
  id: 'id',
  name: 'Added',
  animated: false,
  flags: 0,
  host: {
    url: '//cdn.7tv.app/emote/id',
    files: [{ name: '2x.png', width: 64, height: 32, frame_count: 1, format: 'PNG' }]
  }
};
const stores: Readonly<PersonalEmoteStore>[] = [];
beforeEach(async () => {
  vi.spyOn(sevenTVEvents, 'watch').mockResolvedValue({
    snapshot: { id: 'empty', owner: null, emotes: [] },
    dispose: vi.fn()
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Promise.resolve(Response.json(url.includes('betterttv') ? [] : { sets: {} }))
    )
  );
  await GlobalEmoteStore.createInstance(
    undefined,
    { getAll: () => [] } as unknown as Readonly<AddedEmotesDatabase>,
    {
      use7TVGlobalEmotes: true,
      use7TVPersonalEmotes: true,
      use7TVAddedEmotes: true,
      useBTTVEmotes: true,
      useFFZEmotes: true,
      useTwitchEmotes: true
    }
  );
  vi.mocked(sevenTVEvents.watch).mockClear();
});
afterEach(() => {
  for (const store of stores) store.dispose();
  stores.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('updates the existing catalog from new 7TV snapshots and releases replaced subscriptions', async () => {
  let snapshot: SevenTVEmotes = {
    id: 'set',
    owner: null,
    emotes: [{ id: standalone.id, name: 'Before', flags: 0, timestamp: 1, data: standalone }]
  };
  const dispose = vi.fn();
  const watch = vi.spyOn(sevenTVEvents, 'watch').mockResolvedValue({
    get snapshot(): SevenTVEmotes {
      return snapshot;
    },
    dispose
  });
  const store = await PersonalEmoteStore.create('guild', {
    sevenTv: 'https://7tv.io/v3/emote-sets/set',
    bttv: null,
    ffz: null
  });
  stores.push(store);
  const { catalog } = store;
  expect(catalog.matchSingle('Before')?.name).toBe('Before');
  snapshot = {
    ...snapshot,
    emotes: [{ ...requireValue(snapshot.emotes[0], 'Expected initial emote.'), name: 'After' }]
  };
  expect(catalog.matchSingle('Before')).toBeUndefined();
  expect(catalog.matchSingle('After')?.isSevenTVPersonal).toBe(true);
  await store.changePersonalEmoteSets({ sevenTv: null, bttv: null, ffz: null });
  expect(dispose).toHaveBeenCalledOnce();
  expect(catalog.matchSingle('After')).toBeUndefined();
  expect(watch).toHaveBeenCalledTimes(1);
});

test('supports added emotes in an initially empty store and removes unaliased emotes by ID', async () => {
  const store = await PersonalEmoteStore.create('guild', undefined);
  stores.push(store);
  const { catalog } = store;
  store.addSevenTVEmoteNotInSet(standalone);
  expect(catalog.matchSingle('Added')?.id).toBe('id');
  store.removeSevenTVEmoteNotInSet({ url: 'https://7tv.io/v3/emotes/id', alias: null });
  expect(catalog.matchSingle('Added')).toBeUndefined();
});

test('commits provider changes only after a successful load, and clears disabled sources', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        channelEmotes: [{ id: 'b', code: 'BTTV', animated: false }],
        sharedEmotes: []
      })
    );
  vi.stubGlobal('fetch', fetchMock);
  const initial = {
    sevenTv: null,
    bttv: 'https://api.betterttv.net/3/cached/users/twitch/1',
    ffz: null
  };
  const store = await PersonalEmoteStore.create('guild', initial);
  stores.push(store);
  const { catalog } = store;
  fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
  await expect(
    store.changePersonalEmoteSets({
      ...initial,
      bttv: 'https://api.betterttv.net/3/cached/users/twitch/2'
    })
  ).rejects.toThrow('503');
  expect(store.personalEmoteSets).toEqual(initial);
  expect(catalog.matchSingle('BTTV')?.platform).toBe('bttv');
  await store.changePersonalEmoteSets({ sevenTv: null, bttv: null, ffz: null });
  expect(catalog.matchSingle('BTTV')).toBeUndefined();
});

test('global sources combine live 7TV with provider snapshots and skip unusable assets', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const dispose = vi.fn();
  vi.spyOn(sevenTVEvents, 'watch').mockResolvedValue({
    snapshot: {
      id: 'global',
      owner: null,
      emotes: [{ id: 'id', name: 'Global', flags: 0, timestamp: 0, data: standalone }]
    },
    dispose
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Promise.resolve(
        Response.json(
          url.includes('betterttv') ?
            [{ id: 'bttv', code: 'BTTV', animated: false }]
          : { sets: { '3': { emoticons: [{ id: 3, name: 'FFZ', urls: {} }] } } }
        )
      )
    )
  );
  await GlobalEmoteStore.createInstance(
    undefined,
    { getAll: () => [] } as unknown as AddedEmotesDatabase,
    {
      use7TVGlobalEmotes: true,
      use7TVPersonalEmotes: true,
      use7TVAddedEmotes: true,
      useBTTVEmotes: true,
      useFFZEmotes: true,
      useTwitchEmotes: true
    }
  );
  expect(GlobalEmoteStore.instance.sources.flat().map((asset) => asset.name)).toEqual([
    'Global',
    'BTTV'
  ]);
  await GlobalEmoteStore.createInstance(
    undefined,
    { getAll: () => [] } as unknown as AddedEmotesDatabase,
    {
      use7TVGlobalEmotes: false,
      use7TVPersonalEmotes: false,
      use7TVAddedEmotes: false,
      useBTTVEmotes: false,
      useFFZEmotes: false,
      useTwitchEmotes: false
    }
  );
  expect(dispose).toHaveBeenCalledOnce();
});

test('added-emote loading isolates provider failures and preserves aliases', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const records = [
    { url: 'https://example.com/original', alias: null },
    { url: 'https://example.com/alias', alias: 'Alias' },
    { url: 'https://example.com/failure', alias: null }
  ];
  await GlobalEmoteStore.createInstance(
    undefined,
    { getAll: () => records } as unknown as AddedEmotesDatabase,
    {
      use7TVGlobalEmotes: true,
      use7TVPersonalEmotes: true,
      use7TVAddedEmotes: true,
      useBTTVEmotes: false,
      useFFZEmotes: false,
      useTwitchEmotes: false
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Promise.resolve(
        Response.json(
          url.endsWith('failure') ?
            { error: 'missing emote' }
          : { ...standalone, id: url.endsWith('alias') ? 'alias' : 'original' }
        )
      )
    )
  );
  const store = await PersonalEmoteStore.create('guild', undefined);
  stores.push(store);
  expect(store.catalog.matchSingle('Alias')?.id).toBe('alias');
  expect(store.catalog.matchSingle('Added')?.id).toBe('original');
  await store.refreshBTTVAndFFZPersonalEmotes();
  expect(store.catalog.matchSingle('Alias')?.id).toBe('alias');
});

test('disabled providers never fetch personal/added images or open subscriptions, preserving settings', async () => {
  const getAll = vi.fn().mockReturnValue([{ url: 'https://7tv.io/v3/emotes/id', alias: null }]);
  const emotesGlobal = vi.fn();
  await GlobalEmoteStore.createInstance(
    { emotesGlobal } as unknown as Readonly<TwitchApi>,
    { getAll } as unknown as AddedEmotesDatabase,
    {
      use7TVGlobalEmotes: false,
      use7TVPersonalEmotes: false,
      use7TVAddedEmotes: false,
      useBTTVEmotes: false,
      useFFZEmotes: false,
      useTwitchEmotes: false
    }
  );
  vi.mocked(sevenTVEvents.watch).mockClear();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const sets = {
    sevenTv: 'https://7tv.io/v3/emote-sets/set',
    bttv: 'https://api.betterttv.net/set',
    ffz: 'https://api.frankerfacez.com/set'
  };
  const store = await PersonalEmoteStore.create('guild', sets);
  stores.push(store);
  await store.refreshBTTVAndFFZPersonalEmotes();
  await store.changePersonalEmoteSets(sets);
  expect(store.catalog.matchSingleArray('')).toBeUndefined();
  expect(store.personalEmoteSets).toEqual(sets);
  expect(() => {
    store.addSevenTVEmoteNotInSet(standalone);
  }).toThrow('disabled');
  expect(getAll).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(emotesGlobal).not.toHaveBeenCalled();
  expect(sevenTVEvents.watch).not.toHaveBeenCalled();
});

test.each([
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true]
])(
  '7TV sources are independent: global=%s personal=%s added=%s',
  async (use7TVGlobalEmotes, use7TVPersonalEmotes, use7TVAddedEmotes) => {
    const watch = vi.mocked(sevenTVEvents.watch).mockClear();
    watch.mockImplementation(async (url) =>
      Promise.resolve({
        snapshot: {
          id: url,
          owner: null,
          emotes: [
            {
              id: url,
              name: url.endsWith('/global') ? 'Global' : 'Personal',
              flags: 0,
              timestamp: 1,
              data: standalone
            }
          ]
        },
        dispose: vi.fn()
      })
    );
    const getAll = vi.fn().mockReturnValue([{ url: 'https://7tv.io/v3/emotes/id', alias: null }]);
    const fetchMock = vi.fn().mockResolvedValue(Response.json(standalone));
    vi.stubGlobal('fetch', fetchMock);
    await GlobalEmoteStore.createInstance(undefined, { getAll } as unknown as AddedEmotesDatabase, {
      use7TVGlobalEmotes,
      use7TVPersonalEmotes,
      use7TVAddedEmotes,
      useBTTVEmotes: false,
      useFFZEmotes: false,
      useTwitchEmotes: false
    });
    const sets = { sevenTv: 'https://7tv.io/v3/emote-sets/personal', bttv: null, ffz: null };
    const store = await PersonalEmoteStore.create('guild', sets);
    stores.push(store);
    expect(store.catalog.matchSingle('Global') !== undefined).toBe(use7TVGlobalEmotes);
    expect(store.catalog.matchSingle('Personal') !== undefined).toBe(use7TVPersonalEmotes);
    expect(store.catalog.matchSingle('Added') !== undefined).toBe(use7TVAddedEmotes);
    expect(watch).toHaveBeenCalledTimes(Number(use7TVGlobalEmotes) + Number(use7TVPersonalEmotes));
    expect(getAll).toHaveBeenCalledTimes(Number(use7TVAddedEmotes));
    expect(fetchMock).toHaveBeenCalledTimes(Number(use7TVAddedEmotes));
    expect(store.personalEmoteSets).toEqual(sets);
  }
);
