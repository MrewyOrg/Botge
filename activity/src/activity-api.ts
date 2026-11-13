/* Serializes authenticated API requests and owns the lifetime of one in-memory OAuth session. */

import { isRecord } from './validation.ts';

/** Supported Botge API routes, relative to the Activity proxy mapping. */
export type ActivityPath =
  | 'catalog'
  | 'emotes'
  | 'emotes/remove'
  | 'emotes/batch'
  | 'settings'
  | 'settings/voice'
  | 'settings/emotes'
  | 'settings/emotes/read'
  | 'settings/border'
  | 'settings/border/read';

/**
 * Performs one operation with a guild context and the session's current bearer token.
 *
 * @param path - Botge route relative to the API mapping.
 * @param guildId - Discord guild ID; the server independently verifies caller access.
 * @param fields - Operation-specific JSON fields, excluding the guild ID.
 * @returns Decoded JSON, including application error payloads for the caller to validate.
 * @throws `Error` if authentication, transport, or JSON decoding fails.
 */
type ActivityRequest = (
  path: ActivityPath,
  guildId: string,
  fields?: Readonly<Record<string, unknown>>
) => Promise<unknown>;

/**
 * Bounds a Discord SDK operation to 15 seconds.
 *
 * @remarks
 * Timing out does not cancel the SDK command. Callers must ignore its eventual result.
 * The timer is cleared on both success and failure.
 *
 * @typeParam T - The SDK operation's resolved value.
 * @param operation - Starts one SDK command.
 * @returns The command's result before the deadline.
 * @throws `Error` when the deadline expires; command rejections propagate unchanged.
 */
export async function waitForDiscord<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Discord did not respond. Try again or reopen the Activity.'));
    }, 15_000);
  });
  try {
    return await Promise.race([operation(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates one queued API session for an Activity instance.
 *
 * @remarks
 * Credentials stay in memory and renew 30 seconds before expiry. Only an HTTP 401 carrying
 * the explicit OAuth-expired marker permits one retry; transport and other failures never
 * replay writes. A failed request releases the queue so later requests can proceed.
 *
 * @param commands - Discord SDK adapters for code authorization and token authentication.
 * @returns A request function sharing one token and queue across the instance's guild contexts.
 * @see {@link waitForDiscord}
 */
export function createActivityApi(
  commands: Readonly<{
    authorize: () => Promise<Readonly<{ code: string }>>;
    authenticate: (token: string) => Promise<unknown>;
  }>
): ActivityRequest {
  let requestQueue = Promise.resolve();
  let accessToken: Readonly<{ value: string; expiresAt: number }> | undefined;

  return async (path, guildId, fields) => {
    const request = requestQueue.then(async () => {
      const authorize = async (): Promise<string> => {
        const { code } = await waitForDiscord(commands.authorize);
        const startedAt = Date.now();
        const response = await fetch('/botge-api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, guildId }),
          signal: AbortSignal.timeout(45_000)
        });
        const payload: unknown = await response.json();
        if (
          !response.ok
          || !isRecord(payload)
          || typeof payload['accessToken'] !== 'string'
          || payload['accessToken'] === ''
          || typeof payload['expiresIn'] !== 'number'
          || !Number.isFinite(payload['expiresIn'])
          || payload['expiresIn'] <= 0
        ) {
          throw new Error(
            isRecord(payload) && typeof payload['message'] === 'string' ?
              payload['message']
            : 'Could not authorize Discord. Reopen the Activity.'
          );
        }
        const token = payload['accessToken'];
        await waitForDiscord(async () => await commands.authenticate(token));
        accessToken = {
          value: token,
          expiresAt: startedAt + Math.max(0, payload['expiresIn'] - 30) * 1000
        };
        return token;
      };
      const send = async (): Promise<Readonly<{ payload: unknown; expired: boolean }>> => {
        const token =
          accessToken !== undefined && accessToken.expiresAt > Date.now() ?
            accessToken.value
          : await authorize();
        const response = await fetch(`/botge-api/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ ...fields, guildId }),
          signal: AbortSignal.timeout(45_000)
        });
        const payload: unknown = await response.json();
        return {
          payload,
          expired:
            response.status === 401 && isRecord(payload) && payload['code'] === 'oauth_expired'
        };
      };
      const result = await send();
      // Authentication fails before a mutation. Never retry other failures that may follow a write.
      if (result.expired) {
        accessToken = undefined;
        const retry = await send();
        if (retry.expired) accessToken = undefined;
        return retry.payload;
      }
      return result.payload;
    });
    // Settle the queue on failure as well so later requests can still run.
    requestQueue = request.then(
      () => undefined,
      () => undefined
    );
    return await request;
  };
}
