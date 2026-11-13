/* Exercises session reuse, request ordering, and retry boundaries without mounting the UI. */

import { afterEach, expect, type Mock, test, vi } from 'vitest';

import { createActivityApi } from '../src/activity-api.ts';

function commands(): Readonly<{
  authorize: Mock<() => Promise<Readonly<{ code: string }>>>;
  authenticate: Mock<(token: string) => Promise<unknown>>;
}> {
  return {
    authorize: vi
      .fn<() => Promise<Readonly<{ code: string }>>>()
      .mockResolvedValue({ code: 'code' }),
    authenticate: vi.fn<(token: string) => Promise<unknown>>().mockResolvedValue({})
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('serializes simultaneous requests and shares one session across guilds', async () => {
  const sdk = commands();
  const first = Promise.withResolvers<Response>();
  let writes = 0;
  const fetch = vi.fn(async (path: string) => {
    if (path === '/botge-api/auth')
      return await Promise.resolve(Response.json({ accessToken: 'session', expiresIn: 3600 }));
    writes += 1;
    return await (writes === 1 ? first.promise : Promise.resolve(Response.json({ saved: 2 })));
  });
  vi.stubGlobal('fetch', fetch);
  const request = createActivityApi(sdk);
  const one = request('settings/border', '1', { color: 'FF7700' });
  const two = request('settings/border', '2', { color: '' });
  await vi.waitFor(() => {
    expect(writes).toBe(1);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  first.resolve(Response.json({ saved: 1 }));
  expect(await Promise.all([one, two])).toEqual([{ saved: 1 }, { saved: 2 }]);
  expect(sdk.authorize).toHaveBeenCalledOnce();
  expect(sdk.authenticate).toHaveBeenCalledExactlyOnceWith('session');
  expect(fetch).toHaveBeenLastCalledWith(
    '/botge-api/settings/border',
    expect.objectContaining({
      body: JSON.stringify({ color: '', guildId: '2' }),
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer session' }
    }) as unknown
  );
});

test('retries an explicit OAuth rejection once and discards the rejected replacement token', async () => {
  const sdk = commands();
  let exchanges = 0;
  const expired = { code: 'oauth_expired', message: 'Expired' };
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth') {
      exchanges += 1;
      return Response.json({ accessToken: `session-${exchanges}`, expiresIn: 3600 });
    }
    return Response.json(expired, { status: 401 });
  });
  vi.stubGlobal('fetch', fetch);
  const request = createActivityApi(sdk);
  expect(await request('settings/border', '1', { color: '' })).toEqual(expired);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(await request('settings/border/read', '1')).toEqual(expired);
  expect(exchanges).toBe(4);
  expect(fetch).toHaveBeenCalledTimes(8);
});

test.each(['transport', 'json'] as const)(
  'does not replay a write after a %s failure and releases the queue',
  async (failure) => {
    const sdk = commands();
    let writes = 0;
    const fetch = vi.fn(async (path: string) => {
      if (path === '/botge-api/auth')
        return await Promise.resolve(Response.json({ accessToken: 'session', expiresIn: 3600 }));
      writes += 1;
      if (writes === 1) {
        if (failure === 'transport') throw new Error('Transport failed');
        return await Promise.resolve(new Response('invalid JSON'));
      }
      return await Promise.resolve(Response.json({ saved: true }));
    });
    vi.stubGlobal('fetch', fetch);
    const request = createActivityApi(sdk);
    await expect(request('settings/border', '1', { color: '' })).rejects.toThrow();
    expect(writes).toBe(1);
    expect(await request('settings/border/read', '1')).toEqual({ saved: true });
    expect(writes).toBe(2);
    expect(sdk.authorize).toHaveBeenCalledOnce();
  }
);
