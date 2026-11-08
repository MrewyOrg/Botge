// cspell:words FrankerFaceZ

import { describe, expect, test } from 'vitest';

import { CachedUrl } from 'src/api/cached-url.ts';

describe('CachedUrl', () => {
  const cache = new CachedUrl('http://nginx:80');

  test.each([
    ['cdn.7tv.app', '7tv'],
    ['cdn.betterttv.net', 'bttv'],
    ['cdn.frankerfacez.com', 'ffz'],
    ['static-cdn.jtvnw.net', 'twitch']
  ])('routes %s through nginx', (host, prefix) => {
    expect(cache.get(`https://${host}/emote/test.webp?size=2`)).toEqual([
      `http://nginx:80/${prefix}/emote/test.webp?size=2`,
      true
    ]);
  });

  test.each([
    'https://cdnX7tvYapp/emote/test.webp',
    'https://cdn.7tv.app.example.com/emote/test.webp',
    'https://example.com/https://cdn.7tv.app/emote/test.webp',
    'https://cdn.7tv.app@example.com/emote/test.webp',
    'https://user:password@cdn.7tv.app/emote/test.webp',
    'https://cdn.7tv.app:8443/emote/test.webp',
    'http://cdn.7tv.app/emote/test.webp',
    'not a URL'
  ])('leaves unsupported URLs unchanged: %s', (url) => {
    expect(cache.get(url)).toEqual([url, false]);
  });

  test('leaves supported URLs unchanged when caching is disabled', () => {
    const url = 'https://cdn.7tv.app/emote/test.webp';
    expect(new CachedUrl(undefined).get(url)).toEqual([url, false]);
  });
  test('normalizes trailing slashes and disables blank cache bases', () => {
    const url = 'https://cdn.7tv.app/emote/test.webp';
    expect(new CachedUrl(' http://nginx:80/// ').get(url)).toEqual([
      'http://nginx:80/7tv/emote/test.webp',
      true
    ]);
    expect(new CachedUrl(' ').get(url)).toEqual([url, false]);
  });
});
