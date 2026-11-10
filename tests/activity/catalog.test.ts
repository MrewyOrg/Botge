import { expect, test } from 'vitest';

import { filterEmotes, parseCatalog } from '../../activity/src/catalog.ts';

const still = { name: 'Botge', source: 'Original', image: 'emotes/botge.png', animated: false };
const motion = { name: 'BotgeWave', source: 'Community', image: 'emotes/wave.gif', animated: true };

test('searches names case-insensitively and combines filters', () => {
  const catalog = parseCatalog([still, motion]);
  expect(filterEmotes(catalog, ' BOTGE ', '', '')).toEqual([
    { ...still, composeToken: still.name },
    { ...motion, composeToken: motion.name }
  ]);
  expect(filterEmotes(catalog, 'wave', 'Community', 'animated')).toEqual([
    { ...motion, composeToken: motion.name }
  ]);
  expect(filterEmotes(catalog, '', '', 'static')).toEqual([{ ...still, composeToken: still.name }]);
  expect(filterEmotes(catalog, 'wave', 'Original', 'animated')).toEqual([]);
});

test.each([
  null,
  [null],
  [{ ...still, name: ' ' }],
  [{ ...still, image: 'https://example.com/image.png' }],
  [{ ...still, image: 'emotes/../private.png' }],
  [{ ...still, image: 'emotes/unsafe.svg' }],
  [{ ...still, animated: 'false' }]
])('rejects invalid catalog data %#', (value: unknown) => {
  expect(() => parseCatalog(value)).toThrow();
});

test('accepts only mapped CDN paths in a server catalog', () => {
  const serverEmote = { ...still, image: '/7tv-cdn/emote/id/2x.webp' };
  expect(parseCatalog([serverEmote], true)).toEqual([serverEmote]);
  expect(() => parseCatalog([serverEmote])).toThrow();
  expect(() =>
    parseCatalog([{ ...serverEmote, image: '//example.com/image.png' }], true)
  ).toThrow();
});

test.each([
  '/7tv-cdn/../private.png',
  '/7tv-cdn/%2e%2e/private.png',
  '/7tv-cdn/\t../private.png',
  '/7tv-cdn/image.png#fragment'
])('rejects a noncanonical CDN path %j', (image) => {
  expect(() => parseCatalog([{ ...still, image }], true)).toThrow();
});

test('preserves the query string on mapped CDN URLs', () => {
  const emote = { ...still, image: '/twitch-cdn/emoticons/v2/123/static/light/2.0?v=1' };
  expect(parseCatalog([emote], true)).toEqual([emote]);
});

test('filters individually added emotes independently of platform and motion', () => {
  const inSet = { ...still, source: '7TV', image: '/7tv-cdn/emote/set/2x.webp', added: false };
  const added = { ...motion, source: '7TV', image: '/7tv-cdn/emote/added/2x.webp', added: true };
  const other = { ...still, source: 'BTTV', image: '/bttv-cdn/emote/id/2x.webp' };
  const catalog = parseCatalog([inSet, added, other], true);

  expect(filterEmotes(catalog, '', '7TV', '')).toEqual([inSet, added]);
  expect(filterEmotes(catalog, '', '7TV', 'animated', true)).toEqual([added]);
  expect(filterEmotes(catalog, '', 'BTTV', '', true)).toEqual([]);
  expect(() => parseCatalog([{ ...added, added: 'true' }], true)).toThrow();
});

test('keeps server overlay metadata and validates composable names', () => {
  const overlay = {
    ...motion,
    image: '/7tv-cdn/emote/id/2x.webp',
    zeroWidth: true,
    composeToken: motion.name
  };
  expect(parseCatalog([overlay], true)).toEqual([overlay]);
  expect(() => parseCatalog([{ ...overlay, composeToken: 'Another' }], true)).toThrow();
  expect(() => parseCatalog([{ ...overlay, zeroWidth: 1 }], true)).toThrow();
  expect(parseCatalog([{ ...motion, name: 'Two words' }])[0]?.composeToken).toBeUndefined();
});
