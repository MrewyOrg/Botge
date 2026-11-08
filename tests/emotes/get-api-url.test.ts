// cspell:words FDMJPSF FNZEQ

import { afterEach, expect, test, vi } from 'vitest';

import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import {
  getBttvApiUrlFromBroadcasterName,
  getFfzApiUrlFromBroadcasterName,
  getSevenTvApiUrlFromSevenTvEmoteSetLink
} from 'src/emotes/provider-urls.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('7TV returns the resolved URL and owner without live network access', async () => {
  const id = '01FDMJPSF8000CJ4MDR2FNZEQ3';
  const fetchMock = vi
    .fn()
    .mockResolvedValue(Response.json({ id, emotes: [], owner: { username: 'streamer' } }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await getSevenTvApiUrlFromSevenTvEmoteSetLink(`https://7tv.app/emote-sets/${id}`)).toEqual(
    { type: 'success', url: `https://7tv.io/v3/emote-sets/${id}`, ownerUsername: 'streamer' }
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});

test.each(['not a URL', 'https://example.com', 'https://7tv.app/emote-sets/invalid'])(
  'rejects invalid set link %s before fetching',
  async (link) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await getSevenTvApiUrlFromSevenTvEmoteSetLink(link)).type).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

test('BTTV resolves a Twitch user and requests their channel set', async () => {
  const users = vi.fn().mockResolvedValue({ data: [{ id: '42' }] });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ channelEmotes: [], sharedEmotes: [] }))
  );
  expect(
    await getBttvApiUrlFromBroadcasterName('streamer', { users } as unknown as Readonly<TwitchApi>)
  ).toEqual({ type: 'success', url: 'https://api.betterttv.net/3/cached/users/twitch/42' });
  expect(users).toHaveBeenCalledWith(['streamer']);
});

test('FFZ resolves a room and reports transport failures as errors', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ room: { set: 1 }, sets: {} }))
    .mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetchMock);
  expect(await getFfzApiUrlFromBroadcasterName('Streamer')).toEqual({
    type: 'success',
    url: 'https://api.frankerfacez.com/v1/room/streamer'
  });
  expect((await getFfzApiUrlFromBroadcasterName('Streamer')).type).toBe('error');
});
