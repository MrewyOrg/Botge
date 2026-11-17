// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { connectGameServer } from '../../src/game/game-server.ts';
import type { GameMessage } from '../../src/game/game-state.ts';
import { requireValue } from '../../src/validation.ts';

/** Records what the connector sends and lets the test play the server's part. */
class FakeSocket extends EventTarget {
  public static readonly OPEN = 1 as const;
  public static readonly created: FakeSocket[] = [];
  public readonly sent: string[] = [];
  public readonly url: string;
  public readyState = 0;

  public constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.created.push(this);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  public open(): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  public receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function socket(): FakeSocket {
  return requireValue(FakeSocket.created.at(-1), 'No socket was opened');
}

beforeEach(() => {
  FakeSocket.created.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('presents its ticket first, relays valid messages, and reports a server close', async () => {
  const messages: GameMessage[] = [];
  const onClose = vi.fn<() => void>();
  const connecting = connectGameServer(
    async () => await Promise.resolve({ ticket: 'ticket-1', userId: '42' }),
    'wss://botge.test/game/ws'
  )({
    onMessage(message): void {
      messages.push(message);
    },
    onClose
  });
  await vi.waitFor(() => {
    expect(FakeSocket.created).toHaveLength(1);
  });
  expect(socket().url).toBe('wss://botge.test/game/ws');
  socket().open();
  const connection = await connecting;
  expect(socket().sent).toEqual([JSON.stringify({ type: 'join', ticket: 'ticket-1' })]);
  expect(connection.userId).toBe('42');
  expect(connection.imageUrl('a/b')).toBe('/botge-api/game/image/a%2Fb');

  socket().receive(JSON.stringify({ type: 'wrong' }));
  socket().receive('not json');
  socket().receive(JSON.stringify({ type: 'unknown' }));
  socket().receive(new ArrayBuffer(1));
  expect(messages).toEqual([{ type: 'wrong' }]);

  connection.send({ type: 'guess', text: 'Wave' });
  expect(socket().sent.at(-1)).toBe(JSON.stringify({ type: 'guess', text: 'Wave' }));

  socket().close();
  expect(onClose).toHaveBeenCalledOnce();
  connection.send({ type: 'start' });
  expect(socket().sent).toHaveLength(2);
});

test('does not report a close the page asked for', async () => {
  const onClose = vi.fn<() => void>();
  const connecting = connectGameServer(
    async () => await Promise.resolve({ ticket: 't', userId: '1' })
  )({ onMessage: () => undefined, onClose });
  await vi.waitFor(() => {
    expect(FakeSocket.created).toHaveLength(1);
  });
  expect(socket().url).toBe(`wss://${location.host}/botge-api/game/ws`);
  socket().open();
  (await connecting).close();
  expect(onClose).not.toHaveBeenCalled();
});

test('fails with the API message, a refused socket, or a slow one', async () => {
  const events = { onMessage: () => undefined, onClose: vi.fn<() => void>() } as const;
  await expect(
    connectGameServer(async () => await Promise.resolve({ message: 'Not a member.' }))(events)
  ).rejects.toThrow('Not a member.');
  await expect(
    connectGameServer(async (): Promise<unknown> => await Promise.resolve(null))(events)
  ).rejects.toThrow('Could not join the game.');
  expect(FakeSocket.created).toHaveLength(0);

  const join = async (): Promise<unknown> => await Promise.resolve({ ticket: 't', userId: '1' });
  const refused = connectGameServer(join)(events);
  await vi.waitFor(() => {
    expect(FakeSocket.created).toHaveLength(1);
  });
  socket().close();
  await expect(refused).rejects.toThrow('Could not join the game.');

  vi.useFakeTimers();
  const slow = connectGameServer(join)(events);
  const failed = expect(slow).rejects.toThrow('Could not join the game.');
  await vi.advanceTimersByTimeAsync(15_000);
  await failed;
  expect(socket().readyState).toBe(3);
  expect(events.onClose).not.toHaveBeenCalled();
});
