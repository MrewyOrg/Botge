/* Keeps a ticketed WebSocket open so the server catalog reloads when Botge reports a change. */

import { isRecord } from '../validation.ts';

/** Reconnect delays in milliseconds; the last one repeats until a connection succeeds. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

/** Inputs for {@link watchCatalog}. */
export type CatalogWatchOptions = {
  /** Requests a one-use ticket from the `catalog/watch` route. */
  readonly watch: () => Promise<unknown>;
  /** Reloads the catalog. */
  readonly onChange: () => void;
  /** The watch endpoint; defaults to this page's API mapping. */
  readonly socketUrl?: string;
};

/** Stops a running watch. */
export type CatalogWatch = { readonly stop: () => void };

/**
 * Watches the server catalog and calls `onChange` whenever Botge reports that it changed.
 *
 * @remarks
 * A browser cannot attach the bearer token to a WebSocket, so each connection first obtains a
 * one-use ticket through the authenticated API and presents it in its first message. A dropped
 * connection or failed ticket request reconnects after a growing delay, and the catalog reloads
 * once after reconnecting because changes may have been missed meanwhile. A ticket request that
 * Botge answers without a ticket, as for a caller who is not a member, ends the watch.
 *
 * @param options - Ticket request, change callback and optional endpoint.
 * @returns A handle that stops the watch and closes its connection.
 */
export function watchCatalog(options: CatalogWatchOptions): CatalogWatch {
  const socketUrl = options.socketUrl ?? `wss://${location.host}/botge-api/catalog/ws`;
  let stopped = false;
  let failures = 0;
  let connectedBefore = false;
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Runs `attempt` after the next delay in {@link RETRY_DELAYS_MS}. */
  function retry(attempt: () => Promise<void>): void {
    if (stopped) return;
    const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)];
    failures += 1;
    timer = setTimeout(() => {
      void attempt();
    }, delay);
  }

  async function connect(): Promise<void> {
    let issued: unknown;
    try {
      issued = await options.watch();
    } catch {
      retry(connect);
      return;
    }
    if (stopped) return;
    if (!isRecord(issued) || typeof issued['ticket'] !== 'string') {
      stopped = true;
      return;
    }
    const { ticket } = issued;
    const current = new WebSocket(socketUrl);
    socket = current;
    current.addEventListener('open', () => {
      current.send(JSON.stringify({ type: 'watch', ticket }));
    });
    current.addEventListener('message', (event: Readonly<Pick<MessageEvent, 'data'>>) => {
      if (typeof event.data !== 'string') return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (message['type'] === 'watching') {
        failures = 0;
        if (connectedBefore) options.onChange();
        connectedBefore = true;
      } else if (message['type'] === 'changed') {
        options.onChange();
      }
    });
    current.addEventListener('close', () => {
      if (socket === current) {
        socket = undefined;
        retry(connect);
      }
    });
  }

  void connect();
  return {
    stop(): void {
      stopped = true;
      clearTimeout(timer);
      const current = socket;
      socket = undefined;
      current?.close();
    }
  };
}
