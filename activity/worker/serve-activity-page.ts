/* Serves uncached Activity HTML only after proxy authentication; assets use separate routes. */

import { createProxyAuthenticator } from './proxy-authentication.ts';

/**
 * Restricts the page to its own scripts, styles, API and images.
 *
 * @remarks
 * Inside Discord every request, including provider images and the 7TV API, uses same-origin proxy
 * mappings. Data and blob images cover the generated favicon and previews. Framing is left to
 * Discord, whose clients embed the Activity from several origins.
 */
export const CONTENT_SECURITY_POLICY: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

/** The verifier for the last configured key; a deployment keeps one key, so it is built once. */
let authenticator:
  | { readonly key: string; readonly verify: ReturnType<typeof createProxyAuthenticator> }
  | undefined;

/**
 * Returns the proxy verifier for `key`, building it only when the key changes.
 *
 * @param key - Configured Discord public key.
 * @returns The cached or newly built verifier.
 * @throws `Error` if the key is malformed; nothing is cached then.
 */
function authenticatorFor(key: string): ReturnType<typeof createProxyAuthenticator> {
  if (authenticator?.key !== key) authenticator = { key, verify: createProxyAuthenticator(key) };
  return authenticator.verify;
}

/**
 * Minimal HTTP request shape consumed by the HTML gate.
 *
 * @remarks
 * The URL must be absolute. This subset accepts both Cloudflare requests and local fixtures.
 */
export type ActivityPageRequest = {
  readonly headers: Readonly<Pick<Headers, 'get'>>;
  readonly method: string;
  readonly url: string;
};

/**
 * Serves the Activity HTML after verifying Discord's proxy signature.
 *
 * @remarks
 * Only the root and index page accept GET or HEAD. Every response uses no-store, nosniff and
 * no-referrer, including failures; the page also carries {@link CONTENT_SECURITY_POLICY}. Asset
 * routes are handled separately by the Worker platform. The verifier for a key is built on first
 * use and reused while the key stays the same.
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
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  const path = new URL(request.url).pathname;
  if (path !== '/' && path !== '/index.html') return new Response(null, { status: 404, headers });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD');
    return new Response(null, { status: 405, headers });
  }

  let authenticated: boolean;
  try {
    const verify = authenticatorFor(publicKey ?? '');
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
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  return new Response(request.method === 'HEAD' ? null : html, { headers });
}
