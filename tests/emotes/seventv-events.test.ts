import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { SevenTVEventClient } from 'src/emotes/seventv/event-client.ts';
import { applySetUpdate, isSetUpdate } from 'src/emotes/seventv/set-update.ts';
import type { SevenTVEmotes } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

class Socket extends EventTarget {
  public static instances: Socket[] = [];
  public readonly sent: string[] = [];
  public readonly close = vi.fn();
  public constructor() {
    super();
    Socket.instances.push(this);
  }
  public send(data: string): void {
    this.sent.push(data);
  }
  public receive(op: number, d: Readonly<Record<string, unknown>> = {}): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ op, d }) }));
  }
  public hello(): void {
    this.receive(1, { heartbeat_interval: 10_000, subscription_limit: 100 });
  }
  public ack(id = 'set'): void {
    this.receive(5, {
      command: 'SUBSCRIBE',
      data: { type: 'emote_set.*', condition: { object_id: id } }
    });
  }
  public update(id = 'set'): void {
    this.receive(0, {
      type: 'emote_set.update',
      body: { id, updated: [{ key: 'emotes', nested: true, value: [] }] }
    });
  }
}

function snapshot(name = 'initial'): SevenTVEmotes {
  return {
    id: 'set',
    owner: null,
    emotes: [
      {
        id: 'emote',
        name,
        flags: 0,
        timestamp: 1,
        data: { animated: false, host: { url: '//cdn.7tv.app/emote/emote', files: [] } }
      }
    ]
  };
}

const fetchMock = vi.fn<typeof fetch>();
let client: SevenTVEventClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Socket.instances = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json(snapshot()));
  client = new SevenTVEventClient();
});
afterEach(() => {
  client.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('shares initial fetch and subscription; unsubscribes only after the last consumer leaves', async () => {
  const [a, b] = await Promise.all([
    client.watch('https://7tv.io/v3/emote-sets/set'),
    client.watch('https://7tv.io/v3/emote-sets/set')
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  expect(socket.sent.map((text) => JSON.parse(text) as unknown)).toEqual([
    { op: 35, d: { type: 'emote_set.*', condition: { object_id: 'set' } } }
  ]);
  a.dispose();
  a.dispose();
  expect(socket.sent.length).toBe(1);
  b.dispose();
  expect(
    JSON.parse(requireValue(socket.sent[1], 'Expected indexed test value.')) as unknown
  ).toMatchObject({ op: 36 });
  expect(socket.close).toHaveBeenCalledOnce();
});

test('resynchronizes after ACK, coalesces updates, and ignores unrelated sets', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  socket.ack();
  fetchMock.mockResolvedValueOnce(Response.json(snapshot('after subscribe')));
  await vi.advanceTimersByTimeAsync(100);
  expect(requireValue(watched.snapshot.emotes[0], 'Expected indexed test value.').name).toBe(
    'after subscribe'
  );
  socket.update('other');
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  socket.update();
  socket.update();
  socket.update();
  fetchMock.mockResolvedValueOnce(Response.json(snapshot('renamed')));
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(requireValue(watched.snapshot.emotes[0], 'Expected indexed test value.').name).toBe(
    'renamed'
  );
});

test('does not lose an update received during an in-flight snapshot', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  const pending = Promise.withResolvers<Response>();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json(snapshot('newest')));
  socket.update();
  await vi.advanceTimersByTimeAsync(100);
  socket.update();
  pending.resolve(Response.json(snapshot('older')));
  await vi.advanceTimersByTimeAsync(0);
  expect(requireValue(watched.snapshot.emotes[0], 'Expected indexed test value.').name).toBe(
    'newest'
  );
});

test('reconnects after missed heartbeats and re-subscribes with a fresh snapshot', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  requireValue(Socket.instances[0], 'Expected indexed test value.').hello();
  await vi.advanceTimersByTimeAsync(32_000);
  expect(Socket.instances).toHaveLength(2);
  const socket = requireValue(Socket.instances[1], 'Expected reconnected socket.');
  socket.hello();
  socket.ack();
  fetchMock.mockResolvedValueOnce(Response.json(snapshot('reconnected')));
  await vi.advanceTimersByTimeAsync(100);
  expect(requireValue(watched.snapshot.emotes[0], 'Expected indexed test value.').name).toBe(
    'reconnected'
  );
  expect(socket.sent).toHaveLength(1);
});

test('retries failed snapshots while keeping the last good data; 404 clears a deleted set', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  socket.update();
  fetchMock.mockResolvedValueOnce(new Response('down', { status: 503 }));
  await vi.advanceTimersByTimeAsync(100);
  expect(requireValue(watched.snapshot.emotes[0], 'Expected indexed test value.').name).toBe(
    'initial'
  );
  socket.receive(2);
  fetchMock.mockResolvedValueOnce(new Response('gone', { status: 404 }));
  await vi.advanceTimersByTimeAsync(30_100);
  expect(watched.snapshot.emotes).toEqual([]);
});

test('shutdown during a failed fetch cannot schedule retries or reconnect', async () => {
  await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  const pending = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  socket.update();
  await vi.advanceTimersByTimeAsync(100);
  client.close();
  pending.reject(new Error('offline'));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(Socket.instances).toHaveLength(1);
  await expect(client.watch('https://7tv.io/v3/emote-sets/set')).rejects.toThrow('closed');
});

test('applies additions, aliases, removals, and deletion directly without HTTP refreshes', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  const added = { ...snapshot().emotes[0], id: 'second', name: 'Added' };
  socket.receive(0, {
    type: 'emote_set.update',
    body: { id: 'set', pushed: [{ key: 'emotes', value: added }] }
  });
  expect(watched.snapshot.emotes.map(({ name }) => name)).toEqual(['initial', 'Added']);
  socket.receive(0, {
    type: 'emote_set.update',
    body: { id: 'set', updated: [{ key: 'emotes', value: { ...added, name: 'Alias' } }] }
  });
  expect(requireValue(watched.snapshot.emotes[1], 'Expected indexed test value.').name).toBe(
    'Alias'
  );
  socket.receive(0, {
    type: 'emote_set.update',
    body: { id: 'set', pulled: [{ key: 'emotes', old_value: { id: 'second' } }] }
  });
  expect(watched.snapshot.emotes).toHaveLength(1);
  socket.receive(0, { type: 'emote_set.delete', body: { id: 'set' } });
  expect(watched.snapshot.emotes).toEqual([]);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('honors unlimited subscriptions and maintenance/fatal end-of-stream codes', async () => {
  await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.receive(1, { subscription_limit: -1, heartbeat_interval: 10_000 });
  expect(socket.sent).toHaveLength(1);
  socket.receive(7, { code: 4007 });
  await vi.advanceTimersByTimeAsync(299_999);
  expect(Socket.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1001);
  const reconnected = requireValue(Socket.instances[1], 'Expected reconnected socket.');
  reconnected.receive(7, { code: 4002 });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(Socket.instances).toHaveLength(2);
});

test('malformed protocol fields cannot replace subscriptions or emote snapshots', async () => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket fixture.');
  socket.hello();
  socket.receive(1, { heartbeat_interval: 'fast', subscription_limit: 'all' });
  socket.receive(0, { type: 'emote_set.update', body: { id: 'set', pushed: [null] } });
  await vi.advanceTimersByTimeAsync(100);
  expect(watched.snapshot).toEqual(snapshot());
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(console.error).toHaveBeenCalledTimes(2);
});

test('malformed HTTP snapshots cannot open a live subscription', async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce(Response.json({ id: 'set', emotes: [null], owner: null }));
  await expect(client.watch('https://7tv.io/v3/emote-sets/set')).rejects.toThrow(
    'Invalid 7TV emote set'
  );
  expect(Socket.instances).toEqual([]);
});

test.each([
  { op: 1, d: { heartbeat_interval: 0 } },
  { op: 1, d: { type: 42 } },
  { op: 5, d: { data: null } },
  { op: 1, d: { code: 'invalid' } }
])('invalid event packets leave the subscribed snapshot intact: %j', async (packet: unknown) => {
  const watched = await client.watch('https://7tv.io/v3/emote-sets/set');
  const socket = requireValue(Socket.instances[0], 'Expected socket.');
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(packet) }));
  expect(watched.snapshot.id).toBe('set');
  expect(socket.sent).toEqual([]);
});

test('set updates handle repeated pushes, unrelated fields and unknown removals safely', () => {
  const original = snapshot();
  const emote = requireValue(original.emotes[0], 'Expected emote.');
  expect(
    applySetUpdate(original, { pushed: [{ key: 'emotes', value: { ...emote, name: 'renamed' } }] })
      ?.emotes[0]?.name
  ).toBe('renamed');
  expect(
    applySetUpdate(original, {
      pushed: [{ key: 'name' }],
      updated: [{ key: 'name' }],
      pulled: [{ key: 'name' }, { key: 'emotes', old_value: { id: 'unknown' } }]
    })
  ).toEqual(original);
  expect(applySetUpdate(original, { pushed: [{ key: 'emotes', value: {} }] })).toBeUndefined();
  expect(
    applySetUpdate(original, { updated: [{ key: 'emotes', value: { ...emote, id: 'unknown' } }] })
  ).toBeUndefined();
  expect(applySetUpdate(original, { pulled: [{ key: 'emotes' }] })).toBeUndefined();
  expect(isSetUpdate({ pushed: [{ key: 'emotes', index: 1 }] })).toBe(true);
  expect(isSetUpdate({ pushed: [{ key: 'emotes', index: 1.5 }] })).toBe(false);
  expect(isSetUpdate({ pushed: [{ key: 'emotes', index: 'wrong' }] })).toBe(false);
});
