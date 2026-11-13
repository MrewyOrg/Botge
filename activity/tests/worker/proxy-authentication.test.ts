import { generateKeyPairSync, sign } from 'node:crypto';

import { expect, test } from 'vitest';

import { createProxyAuthenticator } from '../../worker/proxy-authentication.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const authenticate = createProxyAuthenticator(key);

function headers(payload: string, timestamp: string): Record<string, unknown> {
  const bytes = Buffer.from(payload);
  return {
    'x-signature-ed25519': sign(null, bytes, privateKey).toString('hex'),
    'x-discord-proxy-payload': bytes.toString('base64'),
    'x-signature-timestamp': timestamp
  };
}

test('rejects malformed signed JSON and non-object claims', () => {
  for (const payload of ['{', 'null', '[]', '42']) {
    expect(authenticate(headers(payload, '0'))).toBe(false);
  }
});

test('accepts hexadecimal signatures and validates every signed time claim', () => {
  const now = Math.floor(Date.now() / 1000);
  expect(
    authenticate(headers(JSON.stringify({ created_at: now, expires_at: now + 60 }), String(now)))
  ).toBe(true);
  for (const [createdAt, expiresAt, timestamp] of [
    ['invalid', now + 60, String(now)],
    [now + 0.5, now + 60, String(now + 0.5)],
    [now, now + 60, 'wrong'],
    [now + 31, now + 60, String(now + 31)],
    [now, 'invalid', String(now)],
    [now, now + 0.5, String(now)],
    [now, now, String(now)],
    [now + 20, now + 10, String(now + 20)]
  ] as const) {
    expect(
      authenticate(
        headers(JSON.stringify({ created_at: createdAt, expires_at: expiresAt }), timestamp)
      )
    ).toBe(false);
  }
});

test('rejects corrupted signatures before trusting claims', () => {
  const now = Math.floor(Date.now() / 1000);
  const signed = headers(JSON.stringify({ created_at: now, expires_at: now + 60 }), String(now));
  signed['x-signature-ed25519'] = Buffer.alloc(64).toString('base64');
  expect(authenticate(signed)).toBe(false);
  signed['x-signature-ed25519'] = 'invalid!';
  expect(authenticate(signed)).toBe(false);
});
