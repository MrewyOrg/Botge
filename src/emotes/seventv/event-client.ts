import { HttpError, requestJson } from '../../api/http.ts';
import type { SevenTVEmotes } from '../../types.ts';
import { logError } from '../../utils/log-error.ts';
import { checked, isRecord } from '../../utils/validation.ts';
import { parseSevenTVSet } from '../provider-data.ts';
import { applySetUpdate, isSetUpdate, type SetUpdate } from './set-update.ts';

type SetState = {
  readonly url: string;
  users: number;
  snapshot: SevenTVEmotes;
  dirty: boolean;
  pending: Promise<void> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export type SevenTVSet = { readonly snapshot: SevenTVEmotes; readonly dispose: () => void };

type Packet = {
  readonly op: number;
  readonly d: {
    readonly heartbeat_interval?: number;
    readonly subscription_limit?: number;
    readonly type?: string;
    readonly body?: SetUpdate;
    readonly command?: string;
    readonly data?: { readonly condition?: { readonly object_id?: string } };
    readonly code?: number;
  };
};

function isPacket(value: unknown): value is Packet {
  if (
    !isRecord(value)
    || typeof value['op'] !== 'number'
    || !Number.isInteger(value['op'])
    || !isRecord(value['d'])
  )
    return false;
  const { d: data } = value;
  if (
    !['heartbeat_interval', 'subscription_limit', 'code'].every(
      (key) =>
        data[key] === undefined || (typeof data[key] === 'number' && Number.isFinite(data[key]))
    )
  )
    return false;
  if (typeof data['heartbeat_interval'] === 'number' && data['heartbeat_interval'] <= 0)
    return false;
  if (!['type', 'command'].every((key) => data[key] === undefined || typeof data[key] === 'string'))
    return false;
  if (data['body'] !== undefined && !isSetUpdate(data['body'])) return false;
  if (data['data'] === undefined) return true;
  if (!isRecord(data['data'])) return false;
  const { condition } = data['data'];
  return (
    condition === undefined
    || (isRecord(condition)
      && (condition['object_id'] === undefined || typeof condition['object_id'] === 'string'))
  );
}

/** Shared subscriptions, live set mutations, and snapshot recovery after interrupted streams. */
export class SevenTVEventClient {
  readonly #sets = new Map<string, SetState>();
  readonly #loading = new Map<string, Promise<SetState>>();
  readonly #subscribed = new Set<string>();
  #socket: WebSocket | undefined;
  #ready = false;
  #closed = false;
  #retry = 0;
  #limit = Infinity;
  #heartbeatInterval = 30_000;
  #heartbeat: ReturnType<typeof setTimeout> | undefined;
  #reconnect: ReturnType<typeof setTimeout> | undefined;

  public async watch(url: string): Promise<SevenTVSet> {
    this.#assertOpen();
    let state = this.#sets.get(url);
    if (state === undefined) {
      let loading = this.#loading.get(url);
      if (loading === undefined) {
        loading = this.#load(url);
        this.#loading.set(url, loading);
      }
      try {
        state = await loading;
      } finally {
        this.#loading.delete(url);
      }
    }
    this.#assertOpen();
    state.users++;
    this.#connect();
    this.#subscribe(state.snapshot.id);
    const watched = state;
    let disposed = false;
    return {
      get snapshot(): SevenTVEmotes {
        return watched.snapshot;
      },
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        watched.users--;
        if (watched.users > 0) return;
        clearTimeout(watched.timer);
        this.#sets.delete(url);
        const { id } = watched.snapshot;
        if (
          !Array.from(this.#sets.values()).some(
            (set: Readonly<Pick<SetState, 'snapshot'>>) => set.snapshot.id === id
          )
        ) {
          if (this.#ready && this.#subscribed.delete(id)) this.#send(36, id);
        }
        if (this.#sets.size === 0) this.#disconnect();
        else for (const set of this.#sets.values()) this.#subscribe(set.snapshot.id);
      }
    };
  }

  public close(): void {
    this.#closed = true;
    this.#disconnect();
    for (const state of this.#sets.values()) clearTimeout(state.timer);
    this.#sets.clear();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('7TV event client is closed.');
  }

  async #load(url: string): Promise<SetState> {
    const snapshot = parseSevenTVSet(await requestJson(url));
    if (typeof snapshot.id !== 'string' || !Array.isArray(snapshot.emotes))
      throw new Error('Invalid 7TV emote set response.');
    const state: SetState = {
      url,
      snapshot,
      users: 0,
      dirty: false,
      pending: undefined,
      timer: undefined
    };
    if (!this.#closed) this.#sets.set(url, state);
    return state;
  }

  #connect(): void {
    if (
      this.#closed
      || this.#sets.size === 0
      || this.#socket !== undefined
      || this.#reconnect !== undefined
    )
      return;
    const socket = new WebSocket('wss://events.7tv.io/v3');
    this.#socket = socket;
    this.#armHeartbeat();
    socket.addEventListener('message', (event: { readonly data: unknown }) => {
      if (this.#socket !== socket || typeof event.data !== 'string') return;
      try {
        this.#receive(checked(JSON.parse(event.data), isPacket, '7TV event'));
      } catch (error) {
        logError(error, 'Invalid 7TV WebSocket message');
      }
    });
    socket.addEventListener('error', () => {
      if (this.#socket === socket) this.#retryConnection();
    });
    socket.addEventListener(
      'close',
      (event: { readonly code: number; readonly reason: string }) => {
        if (this.#socket !== socket) return;
        this.#handleClose(event.code, event.reason);
      }
    );
  }

  #receive(packet: Packet): void {
    switch (packet.op) {
      case 1:
        this.#ready = true;
        this.#limit =
          (packet.d.subscription_limit ?? -1) < 0 ?
            Infinity
          : (packet.d.subscription_limit ?? Infinity);
        this.#heartbeatInterval = packet.d.heartbeat_interval ?? 30_000;
        this.#armHeartbeat();
        for (const state of this.#sets.values()) this.#subscribe(state.snapshot.id);
        break;
      case 2:
        this.#retry = 0;
        this.#armHeartbeat();
        break;
      case 0:
        if (packet.d.type?.startsWith('emote_set.') === true) {
          for (const state of this.#sets.values()) {
            if (state.snapshot.id !== packet.d.body?.id) continue;
            if (packet.d.type === 'emote_set.delete') {
              state.snapshot = { ...state.snapshot, emotes: [] };
              if (state.pending !== undefined || state.timer !== undefined)
                this.#invalidate(state.url);
            } else {
              const snapshot = applySetUpdate(state.snapshot, packet.d.body);
              if (snapshot !== undefined) state.snapshot = snapshot;
              // A fetch already in flight might otherwise overwrite this newer dispatch.
              if (
                snapshot === undefined
                || state.pending !== undefined
                || state.timer !== undefined
              )
                this.#invalidate(state.url);
            }
          }
        }
        break;
      case 5:
        // Re-snapshot only after subscription ACK closes the initial fetch/subscribe gap.
        if (packet.d.command === 'SUBSCRIBE') {
          for (const state of this.#sets.values()) {
            if (state.snapshot.id === packet.d.data?.condition?.object_id)
              this.#invalidate(state.url);
          }
        }
        break;
      case 4:
        this.#retryConnection();
        break;
      case 6:
        logError(new Error(JSON.stringify(packet.d)), '7TV event API error');
        break;
      case 7:
        this.#handleClose(packet.d.code ?? 1006, 'End of stream');
        break;
      default:
        break;
    }
  }

  #handleClose(code: number, reason: string): void {
    if ([1008, 4001, 4002, 4003, 4004, 4005, 4009, 4010, 4011].includes(code)) {
      logError(new Error(`7TV closed with code ${code}: ${reason}`), '7TV subscription failed');
      this.close();
    } else this.#retryConnection(code === 4007 ? 300_000 : undefined);
  }

  #subscribe(id: string): void {
    if (!this.#ready || this.#subscribed.has(id)) return;
    if (this.#subscribed.size >= this.#limit) {
      logError(new Error('7TV subscription limit reached.'), 'Unable to watch emote set');
      return;
    }
    this.#send(35, id);
    this.#subscribed.add(id);
  }

  #send(op: number, id: string): void {
    this.#socket?.send(
      JSON.stringify({ op, d: { type: 'emote_set.*', condition: { object_id: id } } })
    );
  }

  #invalidate(url: string): void {
    const state = this.#sets.get(url);
    if (state === undefined) return;
    state.dirty = true;
    if (state.pending !== undefined || state.timer !== undefined) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      state.pending = this.#refresh(url).finally(() => {
        state.pending = undefined;
      });
    }, 100);
    state.timer.unref();
  }

  async #refresh(url: string): Promise<void> {
    const state = this.#sets.get(url);
    if (state === undefined) return;
    while (state.dirty && this.#sets.get(url) === state && !this.#closed) {
      state.dirty = false;
      try {
        const snapshot = parseSevenTVSet(await requestJson(url));
        if (!this.#isCurrent(url, state)) return;
        if (snapshot.id !== state.snapshot.id || !Array.isArray(snapshot.emotes))
          throw new Error('Invalid 7TV emote set response.');
        state.snapshot = snapshot;
      } catch (error) {
        if (!this.#isCurrent(url, state)) return;
        if (error instanceof HttpError && error.status === 404) {
          state.snapshot = { ...state.snapshot, emotes: [] };
        } else {
          logError(error, 'Error updating 7TV emote set');
          state.timer = setTimeout(() => {
            state.timer = undefined;
            this.#invalidate(url);
          }, 30_000);
          state.timer.unref();
          return;
        }
      }
    }
  }

  #isCurrent(url: string, state: Readonly<Pick<SetState, 'snapshot'>>): boolean {
    return !this.#closed && this.#sets.get(url) === state;
  }

  #armHeartbeat(): void {
    clearTimeout(this.#heartbeat);
    this.#heartbeat = setTimeout(() => {
      this.#retryConnection();
    }, this.#heartbeatInterval * 3);
    this.#heartbeat.unref();
  }

  #retryConnection(minimum = 1000): void {
    this.#disconnect();
    if (this.#closed || this.#sets.size === 0) return;
    const delay = Math.max(minimum, Math.min(60_000, 1000 * 2 ** this.#retry++));
    this.#reconnect = setTimeout(
      () => {
        this.#reconnect = undefined;
        this.#connect();
      },
      delay + Math.random() * 1000
    );
    this.#reconnect.unref();
  }

  #disconnect(): void {
    clearTimeout(this.#heartbeat);
    clearTimeout(this.#reconnect);
    this.#reconnect = undefined;
    this.#ready = false;
    this.#subscribed.clear();
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
  }
}

export const sevenTVEvents: Readonly<SevenTVEventClient> = new SevenTVEventClient();
