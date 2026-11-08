// cspell:words FDMJPSF FNZEQ

import { afterEach, expect, test, vi } from 'vitest';

import type { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import { stringToPlatform } from 'src/emotes/platforms.ts';
import {
  getBttvApiUrlFromBroadcasterName,
  getFfzApiUrlFromBroadcasterName,
  getSevenTvApiUrlFromSevenTvEmoteSetLink,
  getSevenTvEmoteSetLinkFromSevenTvApiUrl,
  sevenTVUrlToSevenTVNotInSet
} from 'src/emotes/provider-urls.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('accepts both generations of 7TV set IDs and handles sets without an owner', async () => {
  for (const id of ['62cdd34e72a832540de95857', '01FDMJPSF8000CJ4MDR2FNZEQ3']) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ id, owner: null, emotes: [] }))
    );
    expect(
      await getSevenTvApiUrlFromSevenTvEmoteSetLink(`https://7tv.app/emote-sets/${id}/`)
    ).toMatchObject({ type: 'success', url: `https://7tv.io/v3/emote-sets/${id}` });
  }
  expect(
    (
      await getSevenTvApiUrlFromSevenTvEmoteSetLink(
        'https://example.com/emote-sets/62cdd34e72a832540de95857'
      )
    ).type
  ).toBe('error');
});

test('supports current and legacy emote page links and rejects unrelated URLs', async () => {
  const emote = {
    id: 'id',
    name: 'Example',
    flags: 0,
    animated: false,
    host: { url: '//cdn.7tv.app/emote/id', files: [] }
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json(emote))
    .mockResolvedValueOnce(Response.json(emote));
  vi.stubGlobal('fetch', fetchMock);
  expect(await sevenTVUrlToSevenTVNotInSet('https://7tv.app/emotes/id/')).toEqual(emote);
  expect(await sevenTVUrlToSevenTVNotInSet('https://old.7tv.app/emotes/id')).toEqual(emote);
  expect(await sevenTVUrlToSevenTVNotInSet('https://7tv.app.evil/emotes/id')).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('distinguishes missing channel sets from provider outages and encodes room names', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('missing', { status: 404 }))
    .mockResolvedValueOnce(new Response('offline', { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  expect((await getFfzApiUrlFromBroadcasterName('Room/name')).type).toBe('feedback');
  expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.frankerfacez.com/v1/room/room%2Fname');
  expect((await getFfzApiUrlFromBroadcasterName('room')).type).toBe('error');
});

test('BTTV handles missing Twitch users and absent channel emotes', async () => {
  const users = vi
    .fn()
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({ data: [{ id: '1' }] });
  const twitch = { users } as unknown as Readonly<TwitchApi>;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
  expect((await getBttvApiUrlFromBroadcasterName('missing', twitch)).type).toBe('error');
  expect((await getBttvApiUrlFromBroadcasterName('room', twitch)).type).toBe('feedback');
  expect(stringToPlatform('unknown')).toBeUndefined();
});

test('provider error payloads are distinguished from empty sets', async () => {
  const twitch = {
    users: vi.fn().mockResolvedValue({ data: [{ id: '1' }] })
  } as unknown as Readonly<TwitchApi>;
  expect((await getBttvApiUrlFromBroadcasterName('room', undefined)).type).toBe('error');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ message: 'not found' })));
  expect((await getBttvApiUrlFromBroadcasterName('room', twitch)).type).toBe('feedback');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Promise.resolve(Response.json({ error: 'missing' })))
  );
  expect((await getFfzApiUrlFromBroadcasterName('room')).type).toBe('feedback');
  expect(
    (
      await getSevenTvApiUrlFromSevenTvEmoteSetLink(
        'https://7tv.app/emote-sets/62cdd34e72a832540de95857'
      )
    ).type
  ).toBe('error');
  await expect(sevenTVUrlToSevenTVNotInSet('https://7tv.app/emotes/id')).rejects.toThrow('missing');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('offline', { status: 503 })));
  expect((await getBttvApiUrlFromBroadcasterName('room', twitch)).type).toBe('error');
});

test('7TV set API URLs become page links without trailing slashes', () => {
  expect(getSevenTvEmoteSetLinkFromSevenTvApiUrl('https://7tv.io/v3/emote-sets/set///')).toBe(
    'https://7tv.app/emote-sets/set'
  );
});
