import { afterEach, expect, test, vi } from 'vitest';

import { fetchDiscoveryPage, parseDiscoveryPage } from '../../src/catalog/seventv.ts';

const id = '01234567890123456789012345';
const emote = {
  id,
  defaultName: 'Example',
  flags: { animated: true, nsfw: false, private: false, publicListed: true },
  images: [{ url: `https://cdn.7tv.app/emote/${id}/2x.webp` }]
};

function page(items: readonly unknown[]): unknown {
  return { data: { emotes: { search: { pageCount: 3, items } } } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('uses public, safe previews and ignores malformed or unlisted results', () => {
  expect(
    parseDiscoveryPage(
      page([
        emote,
        { ...emote, flags: { ...emote.flags, nsfw: true } },
        { ...emote, flags: { ...emote.flags, private: true } },
        { ...emote, flags: { ...emote.flags, publicListed: false } },
        { ...emote, images: [{ url: 'https://example.com/emote.png' }] },
        { ...emote, id: '../../unsafe' },
        { ...emote, defaultName: ' ' },
        { ...emote, defaultName: 'bad\nname' },
        { ...emote, defaultName: 'x'.repeat(81) },
        null
      ]),
      true
    )
  ).toEqual({
    pageCount: 3,
    emotes: [
      {
        name: 'Example',
        source: '7TV',
        image: `/7tv-cdn/emote/${id}/2x.webp`,
        animated: true,
        sevenTVId: id
      }
    ]
  });
  expect(parseDiscoveryPage(page([emote]), false).emotes[0]?.image).toBe(emote.images[0]?.url);
});

test('rejects GraphQL errors and invalid response shapes', () => {
  expect(() => parseDiscoveryPage({ errors: [{ message: 'Rate limited' }] }, false)).toThrow();
  expect(() => parseDiscoveryPage({ data: {} }, false)).toThrow();
});

test('counts Unicode code points when validating discovery name length', () => {
  const name = '🐱'.repeat(80);
  expect(parseDiscoveryPage(page([{ ...emote, defaultName: name }]), false).emotes[0]?.name).toBe(
    name
  );
  expect(parseDiscoveryPage(page([{ ...emote, defaultName: name + '🐱' }]), false).emotes).toEqual(
    []
  );
});

test.each([
  ['trending', 'TRENDING_WEEKLY'],
  ['top', 'TOP_ALL_TIME']
] as const)(
  'requests the %s ranking with pagination and safe search filters',
  async (mode, sortBy) => {
    const fetch = vi.fn().mockResolvedValue(Response.json(page([emote])));
    vi.stubGlobal('fetch', fetch);
    const result = await fetchDiscoveryPage(
      mode,
      2,
      ' wave ',
      'static',
      true,
      new AbortController().signal
    );
    expect(result.emotes).toHaveLength(1);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      '/7tv-api/v4/gql',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(
          JSON.stringify({
            query: 'wave',
            page: 2,
            perPage: 24,
            sort: { sortBy, order: 'DESCENDING' },
            filters: { nsfw: false, animated: false }
          })
        ) as unknown
      })
    );
  }
);
