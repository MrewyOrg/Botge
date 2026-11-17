/* Validates guessing game messages and defines the connection shared by the server and the demo. */

import type { DeepReadonly } from 'ts-essentials';

import { isRecord } from '../validation.ts';

const PHASES = ['lobby', 'loading', 'ready', 'round', 'reveal', 'final'] as const;

/** Where a room is in its match. */
export type GamePhase = (typeof PHASES)[number];

/**
 * A room as every player sees it.
 *
 * @remarks
 * `image` is an opaque token, resolved to a URL by the connection; it arrives with the ready
 * beat so the picture can load before the round timer starts. `hint` is the name with hidden
 * letters as underscores, present while the round is open. `guesses` are the round's recent
 * wrong guesses, oldest first. `answer`, `winner`, and `points` appear only during the reveal. `remainingMs` counts from the moment the state was
 * sent, so the page never compares its clock with the server's.
 */
export type GameState = DeepReadonly<{
  phase: GamePhase;
  round: number;
  rounds: number;
  roundMs: number;
  players: { id: string; score: number }[];
  guesses: { id: string; text: string }[];
  image?: string;
  hint?: string;
  remainingMs?: number;
  answer?: string;
  winner?: string;
  points?: number;
  notice?: string;
}>;

/** A message from the room: its new state, a wrong guess, or a failure to join. */
export type GameMessage =
  | { readonly type: 'state'; readonly state: GameState }
  | { readonly type: 'wrong' }
  | { readonly type: 'error'; readonly message: string };

/** A message to the room. */
export type GameCommand =
  { readonly type: 'start' } | { readonly type: 'guess'; readonly text: string };

/** An open room connection. */
export type GameConnection = {
  /** The local player's ID, as it appears in {@link GameState} players. */
  readonly userId: string;
  /** Resolves a state's image token to a URL the page can load. */
  readonly imageUrl: (token: string) => string;
  readonly send: (command: GameCommand) => void;
  readonly close: () => void;
};

/** Callbacks a connection invokes until it closes. */
export type GameEvents = {
  readonly onMessage: (message: GameMessage) => void;
  /** Called once when the connection ends for any reason other than `close()`. */
  readonly onClose: () => void;
};

/**
 * Opens a room connection.
 *
 * @throws `Error` with a displayable message when the room cannot be joined.
 */
export type ConnectGame = (events: GameEvents) => Promise<GameConnection>;

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optional<T>(
  value: unknown,
  valid: (candidate: unknown) => candidate is T
): value is T | undefined {
  return value === undefined || valid(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string';
}

function parseState(value: unknown): GameState | undefined {
  if (!isRecord(value)) return undefined;
  const { phase, round, rounds, roundMs, players, image, remainingMs, answer, winner, points } =
    value;
  const { notice, hint, guesses = [] } = value;
  const known = PHASES.find((candidate) => candidate === phase);
  if (
    known === undefined
    || !count(round)
    || !count(rounds)
    || !count(roundMs)
    || !Array.isArray(players)
    || !Array.isArray(guesses)
    || !optional(hint, text)
    || !optional(image, text)
    || !optional(remainingMs, count)
    || !optional(answer, text)
    || !optional(winner, text)
    || !optional(points, count)
    || !optional(notice, text)
  )
    return undefined;
  const scores: { readonly id: string; readonly score: number }[] = [];
  for (const player of players as readonly unknown[]) {
    if (!isRecord(player) || !text(player['id']) || !count(player['score'])) return undefined;
    scores.push({ id: player['id'], score: player['score'] });
  }
  const shared: { readonly id: string; readonly text: string }[] = [];
  for (const guess of guesses as readonly unknown[]) {
    if (!isRecord(guess) || !text(guess['id']) || !text(guess['text'])) return undefined;
    shared.push({ id: guess['id'], text: guess['text'] });
  }
  return {
    phase: known,
    round,
    rounds,
    roundMs,
    players: scores,
    guesses: shared,
    ...(hint === undefined ? {} : { hint }),
    ...(image === undefined ? {} : { image }),
    ...(remainingMs === undefined ? {} : { remainingMs }),
    ...(answer === undefined ? {} : { answer }),
    ...(winner === undefined ? {} : { winner }),
    ...(points === undefined ? {} : { points }),
    ...(notice === undefined ? {} : { notice })
  };
}

/**
 * Validates one decoded room message.
 *
 * @param value - Untrusted JSON from the room connection.
 * @returns The message, or `undefined` when its shape is not recognized.
 */
export function parseGameMessage(value: unknown): GameMessage | undefined {
  if (!isRecord(value)) return undefined;
  switch (value['type']) {
    case 'state': {
      const state = parseState(value['state']);
      return state === undefined ? undefined : { type: 'state', state };
    }
    case 'wrong':
      return { type: 'wrong' };
    case 'error':
      return text(value['message']) ? { type: 'error', message: value['message'] } : undefined;
    default:
      return undefined;
  }
}
