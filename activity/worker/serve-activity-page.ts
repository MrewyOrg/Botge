import { createProxyAuthenticator } from '../../src/api/activity/proxy-authentication.ts';

export type ActivityPageRequest = Readonly<{
  headers: Readonly<Pick<Headers, 'get'>>;
  method: string;
  url: string;
}>;

export function serveActivityPage(
  request: ActivityPageRequest,
  publicKey: string | undefined,
  html: string
): Response {
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
