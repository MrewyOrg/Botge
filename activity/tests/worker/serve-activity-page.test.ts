import { generateKeyPairSync, sign } from 'node:crypto';

import { expect, test, vi } from 'vitest';

import { CONTENT_SECURITY_POLICY, serveActivityPage } from '../../worker/serve-activity-page.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const html = '<!doctype html><title>Botge</title>' as const;
const origin = 'https://botge.example.com' as const;

function signedHeaders(expiresAt: number): Headers {
  const createdAt = Math.floor(Date.now() / 1000) - 5;
  const payload = Buffer.from(JSON.stringify({ created_at: createdAt, expires_at: expiresAt }));
  return new Headers({
    'X-Signature-Ed25519': sign(null, payload, privateKey).toString('base64'),
    'X-Signature-Timestamp': String(createdAt),
    'X-Discord-Proxy-Payload': payload.toString('base64')
  });
}

test.each(['/', '/index.html'])('rejects an unsigned visit to %s', async (path) => {
  const response = serveActivityPage(new Request(origin + path), key, html);
  expect(response.status).toBe(401);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Content-Security-Policy')).toBeNull();
  expect(await response.text()).toBe('Open Botge in Discord.');
});

test.each(['GET', 'HEAD'])('serves a signed %s without caching it', async (method) => {
  const headers = signedHeaders(Math.floor(Date.now() / 1000) + 60);
  const response = serveActivityPage(new Request(origin, { method, headers }), key, html);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
  expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
  expect(CONTENT_SECURITY_POLICY).not.toContain('unsafe');
  expect(await response.text()).toBe(method === 'HEAD' ? '' : html);
});

test('rejects expired signatures and fails closed without a configured key', () => {
  const expired = signedHeaders(Math.floor(Date.now() / 1000) - 1);
  expect(serveActivityPage(new Request(origin, { headers: expired }), key, html).status).toBe(401);
  expect(serveActivityPage(new Request(origin), undefined, html).status).toBe(503);
});

test('rebuilds its verifier when the configured key changes', () => {
  const other = generateKeyPairSync('ed25519');
  const otherKey = other.publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('hex');
  const headers = signedHeaders(Math.floor(Date.now() / 1000) + 60);
  // The same key is reused across requests, and a changed key takes effect at once.
  expect(serveActivityPage(new Request(origin, { headers }), key, html).status).toBe(200);
  expect(serveActivityPage(new Request(origin, { headers }), key, html).status).toBe(200);
  expect(serveActivityPage(new Request(origin, { headers }), otherKey, html).status).toBe(401);
  expect(serveActivityPage(new Request(origin, { headers }), key, html).status).toBe(200);
});

test('serves the entry page only for known paths and navigation methods', () => {
  expect(serveActivityPage(new Request(`${origin}/index`), key, html).status).toBe(404);
  const response = serveActivityPage(new Request(origin, { method: 'POST' }), key, html);
  expect(response.status).toBe(405);
  expect(response.headers.get('Allow')).toBe('GET, HEAD');
});

test('the Worker entry uses the configured Discord public key', async () => {
  const { default: worker } = await import('../../worker/entry.ts');
  const headers = signedHeaders(Math.floor(Date.now() / 1000) + 60);
  const response = worker.fetch(new Request(origin, { headers }), {
    DISCORD_ACTIVITY_PUBLIC_KEY: key
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(html);
});

vi.mock('../../dist/index.html', () => ({ default: html }));
