import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { HttpError, requestJson } from '../http.ts';
import { isSevenTVEmoteId } from '../../emotes/seventv/emote-id.ts';
import { logError } from '../../utils/log-error.ts';
import { isRecord } from '../../utils/validation.ts';
import type { ActivityCatalogEmote } from './catalog.ts';
import { createProxyAuthenticator } from './proxy-authentication.ts';

type ActivityEmotes = (
  guildId: string,
  userId: string,
  emoteId: string | undefined
) => Promise<
  Readonly<{ status: number; message: string; emotes?: readonly ActivityCatalogEmote[] }>
>;

const MAX_REQUEST_BYTES = 4096;
const MAX_ACTIVE_REQUESTS = 8;

type RequestBody = Readonly<Pick<IncomingMessage, 'iterator' | 'setEncoding'>>;
type ActivityRequest = RequestBody
  & Readonly<Pick<IncomingMessage, 'method' | 'url'>>
  & Readonly<{
    headers: Readonly<Pick<IncomingMessage['headers'], 'content-type'>>
      & Readonly<Record<string, unknown>>;
  }>;
type ActivityResponse = Readonly<Pick<ServerResponse, 'destroyed' | 'end' | 'writeHead'>>;

async function readBody(request: RequestBody): Promise<unknown> {
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    if (typeof chunk !== 'string') return undefined;
    body += chunk;
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

async function identifyUser(
  applicationId: string,
  secret: string,
  code: string
): Promise<string | undefined> {
  const token = await requestJson('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: applicationId,
      client_secret: secret,
      grant_type: 'authorization_code',
      code
    }).toString(),
    timeoutMs: 10_000
  });
  if (!isRecord(token) || typeof token['access_token'] !== 'string') return undefined;

  const user = await requestJson('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${token['access_token']}` },
    timeoutMs: 10_000
  });
  const id = isRecord(user) ? user['id'] : undefined;
  return typeof id === 'string' && /^\d{17,20}$/u.test(id) ? id : undefined;
}

export function createActivityEmoteServer(
  applicationId: string,
  secret: string,
  getEmotes: ActivityEmotes,
  proxyPublicKey?: string
): Server {
  const verifyProxy =
    proxyPublicKey === undefined ? undefined : createProxyAuthenticator(proxyPublicKey);
  let active = 0;
  const server = createServer(
    { requestTimeout: 15_000, headersTimeout: 10_000, connectionsCheckingInterval: 1000 },
    (request: ActivityRequest, response: ActivityResponse) => {
      function reply(
        status: number,
        message: string,
        emotes?: readonly ActivityCatalogEmote[]
      ): void {
        response.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Connection': 'close'
        });
        response.end(JSON.stringify({ message, emotes }));
      }

      const adding = request.url === '/emotes';
      if (!adding && request.url !== '/catalog') {
        reply(404, 'Unknown Activity endpoint.');
        return;
      }
      if (
        request.method !== 'POST'
        || request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
      ) {
        reply(400, 'Expected a JSON POST request.');
        return;
      }
      if (verifyProxy !== undefined && !verifyProxy(request.headers)) {
        reply(401, 'Discord Activity proxy authentication failed.');
        return;
      }
      if (active >= MAX_ACTIVE_REQUESTS) {
        reply(503, 'Botge is busy. Try again shortly.');
        return;
      }

      active++;
      async function handle(): Promise<void> {
        const body = await readBody(request);
        const { code, guildId, emoteId } = isRecord(body) ? body : {};
        if (
          typeof code !== 'string'
          || !/^[A-Za-z0-9_-]{1,512}$/u.test(code)
          || typeof guildId !== 'string'
          || !/^\d{17,20}$/u.test(guildId)
          || (adding && !isSevenTVEmoteId(emoteId))
        ) {
          reply(400, 'Invalid emote request.');
          return;
        }

        const userId = await identifyUser(applicationId, secret, code).catch((error: unknown) => {
          if (error instanceof HttpError && (error.status === 400 || error.status === 401))
            return undefined;
          throw error;
        });
        if (userId === undefined) {
          reply(401, 'Discord authorization expired. Try again.');
          return;
        }

        const result = await getEmotes(
          guildId,
          userId,
          adding && typeof emoteId === 'string' ? emoteId : undefined
        );
        reply(result.status, result.message, result.emotes);
      }

      void handle()
        .catch((error: unknown): void => {
          logError(error, 'Error handling Activity emotes');
          if (!response.destroyed)
            reply(500, adding ? 'Could not add this emote.' : 'Could not load server emotes.');
        })
        .finally((): void => {
          active--;
        });
    }
  );
  server.maxConnections = 32;
  return server;
}
