import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { HttpError, requestJson } from 'src/api/http.ts';
import { getRedditAccessToken } from 'src/api/reddit/get-reddit-access-token.ts';
import { RedditApi } from 'src/api/reddit/reddit-api.ts';
import { getTwitchAccessToken } from 'src/api/twitch/get-twitch-access-token.ts';
import { newTwitchApi } from 'src/api/twitch/new-twitch-api.ts';
import { TwitchApi } from 'src/api/twitch/twitch-api.ts';
import { requireValue } from 'src/utils/validation.ts';

const fetchMock = vi.fn<typeof fetch>();
let directory: string;
let tokenPath: string;
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  directory = await mkdtemp(join(tmpdir(), 'botge-auth-'));
  tokenPath = join(directory, 'token.txt');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

test('HTTP failures expose status without leaking credentials or query strings', async () => {
  fetchMock.mockResolvedValue(json({ error: 'secret body' }, 503));
  const error = await requestJson('https://user:password@example.com/api?secret=token').catch(
    (value: unknown) => value
  );
  expect(error).toBeInstanceOf(HttpError);
  expect((error as HttpError).status).toBe(503);
  expect((error as Error).message).toBe('HTTP 503 from https://example.com/api');
  expect(
    requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]?.signal
  ).toBeInstanceOf(AbortSignal);
});

test('OAuth credentials are form encoded and missing tokens are rejected', async () => {
  fetchMock.mockResolvedValueOnce(json({ access_token: 'token' }));
  expect(await getTwitchAccessToken('id &+=', 'secret &+=')).toBe('token');
  const [, options] = requireValue(fetchMock.mock.calls[0], 'Expected OAuth request.');
  const form = new URLSearchParams(options?.body as string);
  expect(form.get('client_id')).toBe('id &+=');
  expect(form.get('client_secret')).toBe('secret &+=');
  fetchMock.mockResolvedValueOnce(json({ error: 'missing token' }));
  await expect(getTwitchAccessToken('id', 'secret')).rejects.toThrow(
    'OAuth response did not contain an access token.'
  );
});

test('Reddit OAuth sends Basic authorization and an explicit User-Agent', async () => {
  fetchMock.mockResolvedValueOnce(json({ access_token: 'reddit-token' }));
  expect(await getRedditAccessToken('id', 'secret')).toBe('reddit-token');
  expect(
    requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]?.headers
  ).toMatchObject({
    'Authorization': `Basic ${Buffer.from('id:secret').toString('base64')}`,
    'User-Agent': 'Botge (https://github.com/MrewyOrg/Botge)'
  });
});

test('concurrent unauthorized requests share one token refresh and retry with the new token', async () => {
  const acquired = Promise.withResolvers<Response>();
  fetchMock
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({}, 401))
    .mockReturnValueOnce(acquired.promise)
    .mockImplementation(async () => {
      await Promise.resolve();
      return json({ data: [] });
    });
  const api = new TwitchApi('id', 'secret', 'old', tokenPath);
  const users = api.users(['user']);
  const games = api.games(['game']);
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  acquired.resolve(json({ access_token: 'new' }));
  await Promise.all([users, games]);
  expect(
    fetchMock.mock.calls.filter(
      (call: readonly unknown[]) => typeof call[0] === 'string' && call[0].includes('/oauth2/token')
    )
  ).toHaveLength(1);
  expect(await readFile(tokenPath, 'utf8')).toBe('new');
  const retries = fetchMock.mock.calls.slice(3);
  expect(retries).toHaveLength(2);
  for (const [, options] of retries)
    expect(options?.headers).toMatchObject({ 'Authorization': 'Bearer new', 'Client-Id': 'id' });
});

test('a second 401 fails without an infinite refresh loop', async () => {
  fetchMock
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: 'new' }))
    .mockResolvedValueOnce(json({}, 401));
  const api = new TwitchApi('id', 'secret', 'old', tokenPath);
  await expect(api.users(['user'])).rejects.toMatchObject({ status: 401 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('validation outages are reported instead of being treated as valid tokens', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 503));
  await expect(
    new TwitchApi('id', 'secret', 'old', tokenPath).validateAndGetNewAccessTokenIfInvalid()
  ).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('Reddit refreshes on 401 and preserves a real forbidden error', async () => {
  fetchMock
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: 'new' }));
  const api = new RedditApi('id', 'secret', 'old', tokenPath);
  await api.validateAndGetNewAccessTokenIfInvalid();
  expect(await readFile(tokenPath, 'utf8')).toBe('new');
  fetchMock.mockResolvedValueOnce(json({}, 403));
  await expect(api.getLivestreamFails()).rejects.toMatchObject({ status: 403 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('empty Twitch batches avoid requests and oversized batches fail locally', async () => {
  const api = new TwitchApi('id', 'secret', 'token', tokenPath);
  expect(await api.users([])).toEqual({ data: [] });
  expect(await api.games([])).toEqual({ data: [] });
  expect(await api.clipsFromIds([])).toEqual({ data: [], pagination: {} });
  await expect(api.users(Array.from({ length: 101 }, () => 'user'))).rejects.toThrow(
    'Cannot request more than 100 items'
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test('Twitch query values are URL encoded', async () => {
  fetchMock.mockImplementation(async () => {
    await Promise.resolve();
    return json({ data: [], pagination: {} });
  });
  const api = new TwitchApi('id', 'secret', 'token', tokenPath);
  await api.users(['a&b']);
  expect(
    new URL(
      requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[0] as string
    ).searchParams.getAll('login')
  ).toEqual(['a&b']);
  await api.clipsFromBroadcasterId('broadcaster', 'cursor&after=other');
  expect(
    new URL(
      requireValue(fetchMock.mock.calls[1], 'Expected indexed test value.')[0] as string
    ).searchParams.getAll('after')
  ).toEqual(['cursor&after=other']);
});

test('the factory reuses a trimmed cached token and validates it', async () => {
  await writeFile(tokenPath, 'cached\n');
  fetchMock.mockResolvedValueOnce(json({}));
  await newTwitchApi('id', 'secret', tokenPath);
  expect(
    requireValue(fetchMock.mock.calls[0], 'Expected indexed test value.')[1]?.headers
  ).toMatchObject({ Authorization: 'Bearer cached' });
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('blank token files acquire and persist a fresh token', async () => {
  await writeFile(tokenPath, ' \n');
  fetchMock.mockResolvedValueOnce(json({ access_token: 'fresh' }));
  await newTwitchApi('id', 'secret', tokenPath);
  expect(await readFile(tokenPath, 'utf8')).toBe('fresh');
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('a failed token refresh does not poison later retries', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({}, 503));
  const api = new TwitchApi('id', 'secret', 'old', tokenPath);
  await expect(api.users(['user'])).rejects.toMatchObject({ status: 503 });
  fetchMock
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: 'recovered' }))
    .mockResolvedValueOnce(json({ data: [] }));
  expect(await api.users(['user'])).toEqual({ data: [] });
  expect(await readFile(tokenPath, 'utf8')).toBe('recovered');
});

test.each(['users', 'games', 'clips', 'emotes'] as const)(
  'malformed Twitch %s payloads fail before entering application code',
  async (endpoint) => {
    const api = new TwitchApi('id', 'secret', 'token', tokenPath);
    fetchMock.mockResolvedValueOnce(json({ data: [{ id: 42 }], pagination: {} }));
    const pending =
      endpoint === 'users' ? api.users(['user'])
      : endpoint === 'games' ? api.games(['game'])
      : endpoint === 'clips' ? api.clipsFromIds(['clip'])
      : api.emotesGlobal();
    await expect(pending).rejects.toThrow('Invalid Twitch');
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);

test('malformed Reddit listings are rejected rather than returned with a typed cast', async () => {
  fetchMock.mockResolvedValueOnce(
    json({ data: { children: [{ data: { permalink: null, over_18: false } }] } })
  );
  await expect(
    new RedditApi('id', 'secret', 'token', tokenPath).getLivestreamFails()
  ).rejects.toThrow('Invalid Reddit listing');
});

test('Reddit factory obtains and persists a fresh token', async () => {
  const { newRedditApi } = await import('src/api/reddit/new-reddit-api.ts');
  fetchMock.mockResolvedValue(json({ access_token: 'fresh' }));
  expect(await newRedditApi('id', 'secret', tokenPath)).toBeInstanceOf(RedditApi);
  expect(await readFile(tokenPath, 'utf8')).toBe('fresh');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([200, 401])(
  'Reddit factory validates cached tokens and refreshes only rejected credentials: %s',
  async (status) => {
    const { newRedditApi } = await import('src/api/reddit/new-reddit-api.ts');
    await writeFile(tokenPath, 'cached');
    fetchMock
      .mockResolvedValueOnce(json({}, status))
      .mockResolvedValueOnce(json({ access_token: 'replacement' }));
    await newRedditApi('id', 'secret', tokenPath);
    expect(await readFile(tokenPath, 'utf8')).toBe(status === 200 ? 'cached' : 'replacement');
    expect(fetchMock).toHaveBeenCalledTimes(status === 200 ? 1 : 2);
  }
);

test.each([
  null,
  {
    id: 'id',
    title: 'title',
    url: 'https://example.com',
    creator_name: 'creator',
    game_id: 'game',
    created_at: 'now',
    view_count: '1',
    thumbnail_url: 'https://example.com/image.png'
  }
])('Twitch rejects malformed clip records: %j', async (record: unknown) => {
  fetchMock.mockResolvedValueOnce(json({ data: [record], pagination: {} }));
  await expect(
    new TwitchApi('id', 'secret', 'token', tokenPath).clipsFromIds(['id'])
  ).rejects.toThrow('Invalid Twitch');
});
test.each([{ id: 'id', name: 42 }, null])(
  'Twitch rejects malformed game metadata: %j',
  async (record: unknown) => {
    fetchMock.mockResolvedValueOnce(json({ data: [record] }));
    await expect(
      new TwitchApi('id', 'secret', 'token', tokenPath).games(new Set(['id']))
    ).rejects.toThrow('Invalid Twitch');
  }
);
test.each([
  { id: 'id', name: 42 },
  { id: 'id', name: 'name', format: [42], theme_mode: [] },
  { id: 'id', name: 'name', format: ['static'], theme_mode: [42] }
])('Twitch rejects malformed emote formats: %j', async (record: unknown) => {
  fetchMock.mockResolvedValueOnce(json({ data: [record] }));
  await expect(new TwitchApi('id', 'secret', 'token', tokenPath).emotesGlobal()).rejects.toThrow(
    'Invalid Twitch'
  );
});
