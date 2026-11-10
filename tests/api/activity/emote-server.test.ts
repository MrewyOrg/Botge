import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterEach, expect, test, vi } from 'vitest';

import { createActivityEmoteServer } from 'src/api/activity/emote-server.ts';
import { createProxyAuthenticator } from 'src/api/activity/proxy-authentication.ts';
import { logError } from 'src/utils/log-error.ts';

vi.mock('src/utils/log-error.ts', () => ({ logError: vi.fn() }));

const guildId = '123456789012345678';
const userId = '234567890123456789';
const emoteId = '01234567890123456789012345';
const payload = { code: 'discord-code', guildId, emoteId };

async function callEndpoint(
  body: string,
  addEmote: Parameters<typeof createActivityEmoteServer>[2] = vi
    .fn()
    .mockResolvedValue({ status: 201, message: 'Added emote.' }),
  method = 'POST',
  url = '/emotes',
  proxy?: Readonly<{ key: string; headers?: Readonly<Record<string, string>> }>
): Promise<Readonly<{ status: number; body: unknown }>> {
  const server = createActivityEmoteServer('app', 'test-secret', addEmote, proxy?.key);
  const request = Object.assign(Readable.from([body]), {
    url,
    method,
    headers: { 'content-type': 'application/json', ...proxy?.headers }
  });
  const result = Promise.withResolvers<Readonly<{ status: number; body: unknown }>>();
  let status = 0;
  server.emit('request', request, {
    writeHead: (code: number): void => {
      status = code;
    },
    end: (text: string): void => {
      result.resolve({ status, body: JSON.parse(text) as unknown });
    }
  });
  return result.promise;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('adds with the identity returned by Discord and leaves tokens out of the reply', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
    .mockResolvedValueOnce(Response.json({ id: userId }));
  vi.stubGlobal('fetch', fetch);
  const add = vi.fn().mockResolvedValue({ status: 201, message: 'Added emote.' });
  const result = await callEndpoint(JSON.stringify({ ...payload, userId: guildId }), add);
  expect(result).toEqual({ status: 201, body: { message: 'Added emote.' } });
  expect(add).toHaveBeenCalledExactlyOnceWith(guildId, userId, emoteId);
  expect(fetch).toHaveBeenNthCalledWith(
    1,
    'https://discord.com/api/v10/oauth2/token',
    expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('code=discord-code') as unknown
    })
  );
  expect(fetch).toHaveBeenNthCalledWith(
    2,
    'https://discord.com/api/v10/users/@me',
    expect.objectContaining({ headers: { Authorization: 'Bearer access-token' } })
  );
});

test.each([
  ['GET', '/emotes', JSON.stringify(payload), 400],
  ['POST', '/unrelated', JSON.stringify(payload), 404],
  ['POST', '/emotes', '{', 400],
  ['POST', '/emotes', 'x'.repeat(4097), 400],
  ['POST', '/emotes', JSON.stringify({ ...payload, code: '' }), 400],
  ['POST', '/emotes', JSON.stringify({ ...payload, guildId: 'invalid' }), 400],
  ['POST', '/emotes', JSON.stringify({ ...payload, emoteId: '../invalid' }), 400]
] as const)(
  'rejects an invalid request before reaching Discord %#',
  async (method, url, body, status) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const add = vi.fn();
    expect((await callEndpoint(body, add, method, url)).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  }
);

test.each([400, 401, 503])('handles OAuth errors without updating storage: %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
  const add = vi.fn();
  expect((await callEndpoint(JSON.stringify(payload), add)).status).toBe(
    status === 503 ? 500 : 401
  );
  expect(add).not.toHaveBeenCalled();
  if (status === 503) expect(logError).toHaveBeenCalledOnce();
});

test.each([{ access_token: false }, { access_token: 'token' }] as const)(
  'rejects invalid OAuth or user data',
  async (token) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(token))
        .mockResolvedValueOnce(Response.json({ id: 'invalid' }))
    );
    const add = vi.fn();
    expect((await callEndpoint(JSON.stringify(payload), add)).status).toBe(401);
    expect(add).not.toHaveBeenCalled();
  }
);

test('catalog reads require OAuth and do not use a supplied emote ID', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
      .mockResolvedValueOnce(Response.json({ id: userId }))
  );
  const emotes = [
    { name: 'Wave', source: '7TV', image: '/7tv-cdn/emote/id/2x.webp', animated: true }
  ];
  const getCatalog = vi.fn().mockResolvedValue({ status: 200, message: 'Loaded', emotes });
  expect(await callEndpoint(JSON.stringify(payload), getCatalog, 'POST', '/catalog')).toEqual({
    status: 200,
    body: { message: 'Loaded', emotes }
  });
  expect(getCatalog).toHaveBeenCalledExactlyOnceWith(guildId, userId, undefined);
});

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

function signedHeaders(
  body: string,
  timestamp: number,
  encoding: 'hex' | 'base64' = 'base64'
): Readonly<Record<string, string>> {
  const bytes = Buffer.from(body);
  return {
    'x-signature-ed25519': sign(null, bytes, privateKey).toString(encoding),
    'x-signature-timestamp': String(timestamp),
    'x-discord-proxy-payload': bytes.toString('base64')
  };
}

test.each(['base64', 'hex'] as const)(
  'authenticates a valid Discord proxy payload with %s encoding',
  (encoding) => {
    const now = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ created_at: now, expires_at: now + 60 });
    expect(createProxyAuthenticator(key)(signedHeaders(body, now, encoding))).toBe(true);
  }
);

test('rejects malformed keys and unsigned, tampered, expired, or invalid proxy payloads', () => {
  expect(() => createProxyAuthenticator('invalid')).toThrow('DISCORD_ACTIVITY_PUBLIC_KEY');
  const verify = createProxyAuthenticator(key);
  const now = Math.floor(Date.now() / 1000);
  const signClaims = (
    created: unknown,
    expires: unknown,
    timestamp = now
  ): Readonly<Record<string, string>> =>
    signedHeaders(JSON.stringify({ created_at: created, expires_at: expires }), timestamp);
  const valid = signClaims(now, now + 60);

  expect(verify({})).toBe(false);
  expect(verify({ ...valid, 'x-discord-proxy-payload': '!' })).toBe(false);
  expect(
    verify({ ...valid, 'x-discord-proxy-payload': Buffer.from('{}').toString('base64') })
  ).toBe(false);
  expect(verify(signedHeaders('{', now))).toBe(false);
  expect(verify(signedHeaders('null', now))).toBe(false);
  expect(verify(signClaims('invalid', now + 60))).toBe(false);
  expect(verify(signClaims(now + 0.5, now + 60))).toBe(false);
  expect(verify(signClaims(now, now + 60, now - 1))).toBe(false);
  expect(verify(signClaims(now + 120, now + 180, now + 120))).toBe(false);
  expect(verify(signClaims(now, 'invalid'))).toBe(false);
  expect(verify(signClaims(now, now + 60.5))).toBe(false);
  expect(verify(signClaims(now - 60, now - 1, now - 60))).toBe(false);
});

test.each(['/catalog', '/emotes'])(
  'requires a valid proxy signature before OAuth on %s',
  async (url) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const getEmotes = vi.fn();

    expect(
      (await callEndpoint(JSON.stringify(payload), getEmotes, 'POST', url, { key })).status
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(getEmotes).not.toHaveBeenCalled();

    fetch
      .mockResolvedValueOnce(Response.json({ access_token: 'access-token' }))
      .mockResolvedValueOnce(Response.json({ id: userId }));
    getEmotes.mockResolvedValue({ status: 200, message: 'OK' });
    const now = Math.floor(Date.now() / 1000);
    const headers = signedHeaders(JSON.stringify({ created_at: now, expires_at: now + 60 }), now);
    expect(
      (await callEndpoint(JSON.stringify(payload), getEmotes, 'POST', url, { key, headers })).status
    ).toBe(200);
    expect(getEmotes).toHaveBeenCalledExactlyOnceWith(
      guildId,
      userId,
      url === '/emotes' ? emoteId : undefined
    );
  }
);
