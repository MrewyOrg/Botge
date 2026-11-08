import { afterEach, expect, test, vi } from 'vitest';

import { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import {
  addedEmoteApiUrl,
  emotePageUrl,
  platformStrings,
  platformToString,
  stringToPlatform
} from 'src/emotes/platforms.ts';
import type { AssetInfo } from 'src/types.ts';

function asset(name: string, overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    id: name,
    name,
    url: 'https://example.com/emote.png',
    zeroWidth: false,
    animated: false,
    width: undefined,
    height: undefined,
    frameCount: undefined,
    platform: 'sevenInSet',
    timestamp: undefined,
    isSevenTVPersonal: false,
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test('matches exact case, case-insensitive exact, then provider priority', () => {
  const global = asset('HappyGlobal');
  const personal = asset('Happy');
  const catalog = new EmoteCatalog(() => [[global], [personal, asset('happy')]]);
  expect(catalog.matchSingle('Happy')).toBe(personal);
  expect(catalog.matchSingle('happy')?.name).toBe('happy');
  expect(catalog.matchSingle('HAPPY')).toBe(personal);
  expect(catalog.matchSingle('app')).toBe(global);
  expect(catalog.matchSingleExact('HAPPY')).toBe(false);
  expect(catalog.matchMulti(['H', 'Happy', 'unknown'])).toEqual([undefined, personal, undefined]);
});

test('stores each asset once and counts distinct matching assets for uniqueness', () => {
  const emote = asset('aaaa');
  const catalog = new EmoteCatalog(() => [[emote, emote]]);
  expect(catalog.matchSingleArray('a')).toEqual([emote]);
  expect(catalog.matchSingleUnique('a', 'aaaa')).toBe(true);
  expect(catalog.matchSingleUnique('a', 'other')).toBe(false);
});

test('ranks every exact and prefix match before substrings with stable source order', () => {
  const catalog = new EmoteCatalog(() => [
    [asset('xxCat'), asset('CatThree'), asset('CatTwo'), asset('CAT'), asset('Cat')]
  ]);
  expect(catalog.matchSingleArray('Cat')?.map(({ name }) => name)).toEqual([
    'Cat',
    'CAT',
    'CatThree',
    'CatTwo',
    'xxCat'
  ]);
  expect(
    catalog.matchSingleArray('Cat', undefined, undefined, undefined, 2)?.map(({ name }) => name)
  ).toEqual(['Cat', 'CAT']);
});

test('applies personal-only autocomplete to nonempty queries and preserves all filters', () => {
  vi.stubEnv('AUTOCOMPLETE_ONLY_7TV_PERSONAL', 'true');
  const personal = asset('HappyPersonal', {
    isSevenTVPersonal: true,
    animated: true,
    zeroWidth: true
  });
  const catalog = new EmoteCatalog(() => [[asset('HappyGlobal'), personal]]);
  expect(catalog.matchSingleArray('Happy', undefined, true, true, 25, false, false, true)).toEqual([
    personal
  ]);
  expect(catalog.matchSingleArray('Happy', 'bttv')).toBeUndefined();
  expect(catalog.matchSingleArray('Happy')?.length).toBe(2);
});

test('observes source replacement without replacing the catalog and restores hidden added emotes', () => {
  let source: readonly AssetInfo[] = [asset('Happy')];
  const added = asset('Happy', { id: 'added', platform: 'sevenNotInSet' });
  const catalog = new EmoteCatalog(() => [source, [added]]);
  expect(catalog.matchSingleArray('Happy')?.length).toBe(1);
  source = [asset('Renamed')];
  expect(catalog.matchSingle('Happy')).toBe(added);
  expect(catalog.matchSingle('Renamed')?.name).toBe('Renamed');
});

test('sorts by timestamp or name and returns no matches for missing substrings', () => {
  const catalog = new EmoteCatalog(() => [
    [asset('Z'), asset('B', { timestamp: 5 }), asset('A', { timestamp: 10 })]
  ]);
  expect(
    catalog
      .matchSingleArray('', undefined, undefined, undefined, undefined, true)
      ?.map(({ name }) => name)
  ).toEqual(['A', 'B', 'Z']);
  expect(
    catalog
      .matchSingleArray('', undefined, undefined, undefined, undefined, false, true)
      ?.map(({ name }) => name)
  ).toEqual(['A', 'B', 'Z']);
  expect(catalog.matchSingleArray('missing')).toBeUndefined();
});

test('deduplicates global/personal copies while retaining personal autocomplete membership', () => {
  vi.stubEnv('AUTOCOMPLETE_ONLY_7TV_PERSONAL', 'true');
  const global = asset('Shared');
  const personal = { ...global, isSevenTVPersonal: true };
  const catalog = new EmoteCatalog(() => [[global], [personal]]);
  expect(catalog.matchSingleArray('Shared')).toHaveLength(1);
  expect(catalog.matchSingleUnique('hare', 'Shared')).toBe(true);
  expect(
    catalog.matchSingleArray('Sha', undefined, undefined, undefined, 25, false, false, true)
  ).toEqual([personal]);
});

test.each(['sevenInSet', 'sevenNotInSet', 'bttv', 'ffz', 'twitch'] as const)(
  'platform labels and page URLs support %s',
  (platform) => {
    const emote = asset('Name with spaces', { id: 'id', platform });
    const label = platformToString(platform);
    expect(platformStrings()).toContain(label);
    expect(stringToPlatform(label)).toBe(platform);
    const url = emotePageUrl(emote);
    expect(url).toBe(
      platform === 'twitch' ? emote.url
      : platform === 'ffz' ? 'https://www.frankerfacez.com/emoticon/id-Name%20with%20spaces'
      : platform === 'bttv' ? 'https://betterttv.com/emotes/id'
      : 'https://7tv.app/emotes/id'
    );
    expect(addedEmoteApiUrl(emote)).toBe(
      platform === 'sevenNotInSet' ? 'https://7tv.io/v3/emotes/id' : undefined
    );
  }
);
