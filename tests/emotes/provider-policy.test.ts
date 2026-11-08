import { expect, test } from 'vitest';

import {
  type EmoteProviderSettings,
  isEmoteEnabled,
  isEmoteUrlEnabled
} from 'src/emotes/provider-policy.ts';

const disabled: EmoteProviderSettings = {
  use7TVGlobalEmotes: false,
  use7TVPersonalEmotes: false,
  use7TVAddedEmotes: false,
  useBTTVEmotes: false,
  useFFZEmotes: false,
  useTwitchEmotes: false
};

test.each([
  ['use7TVAddedEmotes', 'https://7tv.app/emotes/id'],
  ['use7TVAddedEmotes', 'https://old.7tv.app/emotes/id'],
  ['use7TVAddedEmotes', 'https://7tv.io/v3/emotes/id'],
  ['use7TVAddedEmotes', 'https://cdn.7tv.app/emote/id/2x.webp'],
  ['useBTTVEmotes', 'https://betterttv.com/emotes/id'],
  ['useBTTVEmotes', 'https://cdn.betterttv.net/emote/id/2x'],
  ['useFFZEmotes', 'https://www.frankerfacez.com/emoticon/1'],
  ['useFFZEmotes', 'https://cdn.frankerfacez.com/emote/1/2'],
  ['useTwitchEmotes', 'https://static-cdn.jtvnw.net/emoticons/v2/id/static/dark/2.0']
] as const)('gates %s URLs without requiring other providers: %s', (setting, url) => {
  expect(isEmoteUrlEnabled(url, disabled)).toBe(false);
  expect(isEmoteUrlEnabled(url, { ...disabled, [setting]: true })).toBe(true);
});

test.each([
  '😀',
  'not a URL',
  'https://example.com/image.png',
  'https://7tv.app.example.com/image.png',
  'https://static-cdn.jtvnw.net/other/image.png'
])('keeps unrelated inputs available: %s', (input) => {
  expect(isEmoteUrlEnabled(input, disabled)).toBe(true);
});

test.each([
  ['use7TVGlobalEmotes', 'sevenInSet', false],
  ['use7TVPersonalEmotes', 'sevenInSet', true],
  ['use7TVAddedEmotes', 'sevenNotInSet', false],
  ['useBTTVEmotes', 'bttv', false],
  ['useFFZEmotes', 'ffz', false],
  ['useTwitchEmotes', 'twitch', false]
] as const)(
  'catalog source %s is enabled independently',
  (setting, platform, isSevenTVPersonal) => {
    const asset = { platform, isSevenTVPersonal };
    expect(isEmoteEnabled(asset, disabled)).toBe(false);
    expect(isEmoteEnabled(asset, { ...disabled, [setting]: true })).toBe(true);
    const othersEnabled = Object.fromEntries(
      Object.keys(disabled).map((key) => [key, key !== setting])
    );
    expect(isEmoteEnabled(asset, { ...disabled, ...othersEnabled })).toBe(false);
  }
);

test('global and personal switches cannot bypass the standalone URL policy', () => {
  expect(
    isEmoteUrlEnabled('https://cdn.7tv.app/emote/id/2x.webp', {
      ...disabled,
      use7TVGlobalEmotes: true,
      use7TVPersonalEmotes: true
    })
  ).toBe(false);
});
