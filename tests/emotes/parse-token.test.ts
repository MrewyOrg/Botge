import { expect, test, vi } from 'vitest';

import { sevenTVUrlToSevenTVNotInSet } from 'src/emotes/provider-urls.ts';
import { parseToken } from 'src/emotes/rendering/parse-token.ts';

const providers = {
  use7TVGlobalEmotes: true,
  use7TVPersonalEmotes: true,
  use7TVAddedEmotes: true,
  useBTTVEmotes: true,
  useFFZEmotes: true,
  useTwitchEmotes: true
};

vi.mock('src/emotes/provider-urls.ts', () => ({
  sevenTVUrlToSevenTVNotInSet: vi.fn().mockResolvedValue(undefined)
}));

test.each(['https://example.com/image.png', 'https://tenor.com/view/name-123.gif'])(
  'preserves asset URLs: %s',
  async (url) => {
    expect(await parseToken(url, false, providers)).toBe(url);
  }
);
test('Tenor pages are converted to GIF URLs', async () => {
  expect(await parseToken('https://tenor.com/view/name-123', false, providers)).toBe(
    'https://tenor.com/view/name-123.gif'
  );
});
test.each([
  ['a', '1f1e6'],
  ['Z', '1f1ff'],
  ['0', '30-20e3'],
  ['9', '39-20e3'],
  ['😀', '1f600']
])('converts %s into a Twemoji image', async (token, id) => {
  expect(await parseToken(token, false, providers)).toEqual(
    expect.stringContaining('/72x72/' + id + '.png')
  );
});
test('unrecognized text has no asset', async () => {
  expect(await parseToken('not an emoji', true, providers)).toBeUndefined();
  expect(sevenTVUrlToSevenTVNotInSet).toHaveBeenCalledWith('not an emoji');
});

test.each([false, true])(
  '7TV token parsing selects the requested maximum size: %s',
  async (highest) => {
    vi.mocked(sevenTVUrlToSevenTVNotInSet).mockResolvedValueOnce({
      id: 'id',
      name: 'Test',
      flags: 0,
      animated: false,
      host: {
        url: '//example.com',
        files: [2, 4].map((size) => ({
          name: String(size) + 'x.png',
          width: size * 32,
          height: size * 32,
          frame_count: 1,
          format: 'PNG'
        }))
      }
    });
    expect(await parseToken('https://7tv.app/emotes/id', highest, providers)).toMatchObject({
      url: 'https://example.com/' + (highest ? '4' : '2') + 'x.png'
    });
  }
);

test('rejects disabled 7TV pages before resolving their images', async () => {
  vi.mocked(sevenTVUrlToSevenTVNotInSet).mockClear();
  await expect(
    parseToken('https://7tv.app/emotes/id', false, { ...providers, use7TVAddedEmotes: false })
  ).rejects.toThrow('disabled');
  expect(sevenTVUrlToSevenTVNotInSet).not.toHaveBeenCalled();
});
