/* Serializes authenticated API requests and owns the lifetime of one in-memory OAuth session. */

import type { DeepReadonly, ValueOf } from 'ts-essentials';

import type { EmoteSettings } from './settings/emote-settings.ts';
import type { VoiceSettings } from './settings/voice-settings.ts';
import { isRecord } from './validation.ts';

/** Route-specific JSON bodies. Read routes take no operation fields. */
type ActivityFields = {
  'catalog': undefined;
  'emotes': { readonly emoteId: string };
  'emotes/remove': { readonly emoteId: string };
  'emotes/batch': { readonly action: 'add' | 'remove'; readonly emoteIds: readonly string[] };
  'settings': undefined;
  'settings/voice': { readonly voice: VoiceSettings };
  'settings/emotes': { readonly emotes: EmoteSettings };
  'settings/emotes/read': undefined;
  'settings/border': { readonly color: string };
  'settings/border/read': undefined;
};

/** Supported Botge API routes, relative to the Activity proxy mapping. */
type ActivityPath = keyof ActivityFields;

/** Keeps each route correlated with its required body, including forwarded calls. */
export type ActivityOperation = ValueOf<{
  [Path in ActivityPath]: ActivityFields[Path] extends undefined ?
    readonly [path: Path, guildId: string, fields?: never]
  : readonly [path: Path, guildId: string, fields: DeepReadonly<ActivityFields[Path]>];
}>;

/**
 * Performs one guild operation with the current bearer token.
 *
 * @param operation - Route, guild ID, and the route's required JSON fields.
 * @returns Untrusted JSON, including application errors; callers validate the result.
 * @throws `Error` if authentication, transport, or JSON decoding fails.
 */
type ActivityRequest = (...operation: ActivityOperation) => Promise<unknown>;

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
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timeout.reject(new Error('Discord did not respond. Try again or reopen the Activity.'));
  }, 15_000);
  try {
    return await Promise.race([operation(), timeout.promise]);
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
export function createActivityApi(commands: {
  readonly authorize: () => Promise<{ readonly code: string }>;
  readonly authenticate: (token: string) => Promise<unknown>;
}): ActivityRequest {
  let requestQueue = Promise.resolve();
  let accessToken: { readonly value: string; readonly expiresAt: number } | undefined;

  return async (...[path, guildId, fields]) => {
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
      const send = async (): Promise<{ readonly payload: unknown; readonly expired: boolean }> => {
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
