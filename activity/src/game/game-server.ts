/* Connects the guessing game to a Botge room over a ticketed WebSocket. */

import { isRecord } from '../validation.ts';
import { type ConnectGame, type GameConnection, parseGameMessage } from './game-state.ts';

const CONNECT_DEADLINE_MS = 15_000 as const;
const JOIN_FAILED = 'Could not join the game. Reopen it to try again.' as const;

/**
 * Creates a connector for the room of this Activity instance.
 *
 * @remarks
 * A browser cannot attach the bearer token to a WebSocket, so `join` first obtains a one-use
 * ticket through the authenticated API and the socket presents it in its first message. Round
 * images are requested by an opaque token that changes every round.
 *
 * @param join - Requests a ticket from the `game/join` route.
 * @param socketUrl - The room endpoint; defaults to this page's API mapping.
 * @returns A connector that joins once per call.
 */
export function connectGameServer(
  join: () => Promise<unknown>,
  socketUrl = `wss://${location.host}/botge-api/game/ws`
): ConnectGame {
  return async (events) => {
    const issued = await join();
    if (
      !isRecord(issued)
      || typeof issued['ticket'] !== 'string'
      || typeof issued['userId'] !== 'string'
    )
      throw new Error(
        isRecord(issued) && typeof issued['message'] === 'string' ? issued['message'] : JOIN_FAILED
      );
    const { ticket, userId } = issued;

    const socket = new WebSocket(socketUrl);
    const opened = Promise.withResolvers<undefined>();
    const timer = setTimeout(() => {
      opened.reject(new Error(JOIN_FAILED));
    }, CONNECT_DEADLINE_MS);
    let live = false;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', ticket }));
      opened.resolve(undefined);
    });
    socket.addEventListener('message', (event: Readonly<Pick<MessageEvent, 'data'>>) => {
      if (typeof event.data !== 'string') return;
      let decoded: unknown;
      try {
        decoded = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = parseGameMessage(decoded);
      if (message !== undefined) events.onMessage(message);
    });
    socket.addEventListener('close', () => {
      opened.reject(new Error(JOIN_FAILED));
      if (!live) return;
      live = false;
      events.onClose();
    });
    try {
      await opened.promise;
      live = true;
    } catch (error) {
      socket.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const connection: GameConnection = {
      userId,
      imageUrl: (token) => `/botge-api/game/image/${encodeURIComponent(token)}`,
      send(command): void {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command));
      },
      close(): void {
        live = false;
        socket.close();
      }
    };
    return connection;
  };
}
