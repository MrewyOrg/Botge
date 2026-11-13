/* Serves uncached Activity HTML only after proxy authentication; assets use separate routes. */

import { createProxyAuthenticator } from './proxy-authentication.ts';

/**
 * Minimal HTTP request shape consumed by the HTML gate.
 *
 * @remarks
 * The URL must be absolute. This subset accepts both Cloudflare requests and local fixtures.
 */
export type ActivityPageRequest = Readonly<{
  headers: Readonly<Pick<Headers, 'get'>>;
  method: string;
  url: string;
}>;

/**
 * Serves the Activity HTML after verifying Discord's proxy signature.
 *
 * @remarks
 * Only the root and index page accept GET or HEAD. Every response uses no-store, including
 * failures. Asset routes are handled separately by the Worker platform.
 *
 * @param request - Request with an absolute URL and proxy headers.
 * @param publicKey - Configured Discord public key; missing or malformed keys fail closed.
 * @param html - Bundled Activity document to return after authentication.
 * @returns An uncached response: 200 on success, 401 for failed authentication, 503 for invalid
 * configuration, 404 for other paths, or 405 for other methods. HEAD responses have no body.
 * @throws `TypeError` if the request URL is not absolute and valid.
 * @see {@link createProxyAuthenticator}
 */
export function serveActivityPage(
  request: ActivityPageRequest,
  publicKey: string | undefined,
  html: string
): Response {
  // Every visit must reach the signature check, including visits after a successful response.
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const path = new URL(request.url).pathname;
  if (path !== '/' && path !== '/index.html') return new Response(null, { status: 404, headers });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD');
    return new Response(null, { status: 405, headers });
  }

  let authenticated: boolean;
  try {
    const verify = createProxyAuthenticator(publicKey ?? '');
    authenticated = verify({
      'x-signature-ed25519': request.headers.get('X-Signature-Ed25519'),
      'x-signature-timestamp': request.headers.get('X-Signature-Timestamp'),
      'x-discord-proxy-payload': request.headers.get('X-Discord-Proxy-Payload')
    });
  } catch {
    return new Response(null, { status: 503, headers });
  }

  if (!authenticated)
    return new Response(request.method === 'HEAD' ? null : 'Open Botge in Discord.', {
      status: 401,
      headers
    });

  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(request.method === 'HEAD' ? null : html, { headers });
}
