// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { watchCatalog } from '../../src/catalog/catalog-watch.ts';
import { requireValue } from '../../src/validation.ts';

/** Records what the watcher sends and lets the test play the server's part. */
class FakeSocket extends EventTarget {
  public static readonly created: FakeSocket[] = [];
  public readonly sent: string[] = [];
  public readonly url: string;
  public closed = false;

  public constructor(url: string) {
    super();
    this.url = url;
    FakeSocket.created.push(this);
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  public open(): void {
    this.dispatchEvent(new Event('open'));
  }

  public receive(type: string): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type }) }));
  }
}

function socket(): FakeSocket {
  return requireValue(FakeSocket.created.at(-1), 'No socket was opened');
}

/** Lets pending ticket requests settle without advancing the retry timers. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  FakeSocket.created.length = 0;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('presents its ticket and reloads on each reported change', async () => {
  const onChange = vi.fn<() => void>();
  const watch = watchCatalog({
    watch: async () => await Promise.resolve({ ticket: 'ticket-1' }),
    onChange,
    socketUrl: 'wss://example.test/botge-api/catalog/ws'
  });
  await settle();
  expect(socket().url).toBe('wss://example.test/botge-api/catalog/ws');
  socket().open();
  expect(socket().sent).toEqual([JSON.stringify({ type: 'watch', ticket: 'ticket-1' })]);
  // The first confirmation follows the page's own load, so it reloads nothing.
  socket().receive('watching');
  expect(onChange).not.toHaveBeenCalled();
  socket().receive('changed');
  socket().dispatchEvent(new MessageEvent('message', { data: 'not json' }));
  socket().receive('unknown');
  expect(onChange).toHaveBeenCalledTimes(1);
  watch.stop();
  expect(socket().closed).toBe(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(FakeSocket.created).toHaveLength(1);
});

test('reconnects with growing delays and reloads once after reconnecting', async () => {
  const onChange = vi.fn<() => void>();
  let tickets = 0;
  const watch = watchCatalog({
    async watch() {
      tickets += 1;
      if (tickets === 2) throw new Error('Discord is busy.');
      return await Promise.resolve({ ticket: `ticket-${String(tickets)}` });
    },
    onChange
  });
  await settle();
  socket().open();
  socket().receive('watching');
  socket().close();
  // The first retry waits one second and its ticket request fails; the next waits two.
  await vi.advanceTimersByTimeAsync(999);
  expect(tickets).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(tickets).toBe(2);
  expect(FakeSocket.created).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2_000);
  expect(tickets).toBe(3);
  socket().open();
  socket().receive('watching');
  expect(onChange).toHaveBeenCalledTimes(1);
  watch.stop();
});

test('stops watching when Botge refuses to issue a ticket', async () => {
  const watch = vi.fn(async () => await Promise.resolve({ message: 'Not a member.' }));
  watchCatalog({ watch, onChange: vi.fn<() => void>() });
  await settle();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(watch).toHaveBeenCalledTimes(1);
  expect(FakeSocket.created).toHaveLength(0);
});

test('ignores binary and non-object messages', async () => {
  const onChange = vi.fn<() => void>();
  const watch = watchCatalog({
    watch: async () => await Promise.resolve({ ticket: 'ticket-1' }),
    onChange
  });
  await settle();
  socket().open();
  socket().dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(1) }));
  socket().dispatchEvent(new MessageEvent('message', { data: '42' }));
  expect(onChange).not.toHaveBeenCalled();
  watch.stop();
});

test('opens nothing and retries nothing after it stops', async () => {
  const pending = Promise.withResolvers<unknown>();
  const granted = watchCatalog({
    watch: async () => await pending.promise,
    onChange: vi.fn<() => void>()
  });
  // Stopping while a ticket is on its way keeps the late ticket from opening a socket.
  granted.stop();
  pending.resolve({ ticket: 'late' });
  await settle();
  expect(FakeSocket.created).toHaveLength(0);

  const failing = Promise.withResolvers<unknown>();
  const watch = vi.fn(async () => await failing.promise);
  const refused = watchCatalog({ watch, onChange: vi.fn<() => void>() });
  refused.stop();
  failing.reject(new Error('Discord is busy.'));
  await settle();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(watch).toHaveBeenCalledTimes(1);
});
