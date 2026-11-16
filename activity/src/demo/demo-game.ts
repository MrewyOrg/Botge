/* Single-player stand-in for a Botge game room, used by the browser-only demo. */

import type { DeepReadonly } from 'ts-essentials';

import type { ConnectGame, GamePhase, GameState } from '../game/game-state.ts';

const ROUNDS = 10 as const;
const ROUND_MS = 20_000 as const;
const READY_MS = 3000 as const;
const REVEAL_MS = 5000 as const;
const FIRST_LETTER_MS = 10_000 as const;
const SECOND_LETTER_MS = 15_000 as const;
const MAX_SHARED_GUESSES = 8 as const;
const MAX_SHARED_GUESS_CHARS = 40 as const;
const PLAYER_ID = 'demo-player' as const;

/** One guessable picture and the name that answers it. */
export type DemoGameEmote = { readonly name: string; readonly image: string };

/** Four points in the first quarter of a round, down to one in the last, like the server. */
function pointsAfter(elapsedMs: number): number {
  return 4 - Math.min(3, Math.max(0, Math.floor((elapsedMs * 4) / ROUND_MS)));
}

/**
 * Masks a name like the server: the first letter shows halfway through the round and the middle
 * letter at three quarters, never more than a third of the name; whitespace always shows.
 */
export function maskName(answer: string, elapsedMs: number): string {
  const letters = Array.from(answer);
  const due = Number(elapsedMs >= FIRST_LETTER_MS) + Number(elapsedMs >= SECOND_LETTER_MS);
  const shown = Math.min(due, Math.floor(letters.length / 3));
  const middle = Math.floor(letters.length / 2);
  return letters
    .map((letter, index) => {
      const revealed = (shown >= 1 && index === 0) || (shown >= 2 && index === middle);
      return revealed || letter.trim() === '' ? letter : '_';
    })
    .join('');
}

/** Returns the pool in a random order, leaving the input unchanged. */
function shuffled(items: readonly DemoGameEmote[]): readonly DemoGameEmote[] {
  const order = [...items];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    const [left, right] = [order[index], order[other]];
    if (left !== undefined && right !== undefined) {
      order[index] = right;
      order[other] = left;
    }
  }
  return order;
}

/**
 * Creates an in-memory room with the server's rules and timings.
 *
 * @remarks
 * Rounds, scoring, and message shapes follow the Botge API so the page behaves the same. The
 * room has one player, holds no state between connections, and never reaches the network.
 *
 * @param pool - Pictures to guess; each match plays up to ten of them in random order.
 * @returns A connector whose room starts in the lobby.
 */
export function connectDemoGame(pool: readonly DemoGameEmote[]): ConnectGame {
  return async (events) => {
    await Promise.resolve();
    const images = new Map<string, string>();
    let phase: GamePhase = 'lobby';
    let score = 0;
    let round = 0;
    let picks: readonly DemoGameEmote[] = [];
    let startedAt = 0;
    let guesses: readonly { readonly id: string; readonly text: string }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    function emit(extra: DeepReadonly<Partial<GameState>> = {}): void {
      if (closed) return;
      events.onMessage({
        type: 'state',
        state: {
          phase,
          round,
          rounds: picks.length,
          roundMs: ROUND_MS,
          players: [{ id: PLAYER_ID, score }],
          guesses,
          ...extra
        }
      });
    }

    function later(delayMs: number, action: () => void): void {
      clearTimeout(timer);
      timer = setTimeout(action, delayMs);
    }

    function token(): string {
      return `demo-round-${round}`;
    }

    /** Sends the open round with its remaining time and current hint. */
    function emitRound(pick: DemoGameEmote): void {
      const elapsed = Date.now() - startedAt;
      emit({
        image: token(),
        remainingMs: Math.max(0, ROUND_MS - elapsed),
        hint: maskName(pick.name, elapsed)
      });
    }

    // Rounds and reveals schedule each other, so both live on one object.
    const match = {
      nextRound(): void {
        const pick = picks[round];
        if (pick === undefined) {
          phase = 'final';
          guesses = [];
          emit();
          return;
        }
        round += 1;
        phase = 'ready';
        guesses = [];
        images.clear();
        images.set(token(), pick.image);
        emit({ image: token(), remainingMs: READY_MS });
        later(READY_MS, () => {
          phase = 'round';
          startedAt = Date.now();
          emitRound(pick);
          // Each hint letter is sent when it appears, then the timer ends the round.
          later(FIRST_LETTER_MS, () => {
            emitRound(pick);
            later(SECOND_LETTER_MS - FIRST_LETTER_MS, () => {
              emitRound(pick);
              later(ROUND_MS - SECOND_LETTER_MS, () => {
                match.reveal(pick, false);
              });
            });
          });
        });
      },
      reveal(pick: DemoGameEmote, won: boolean): void {
        const points = won ? pointsAfter(Date.now() - startedAt) : 0;
        score += points;
        phase = 'reveal';
        emit({
          image: token(),
          remainingMs: REVEAL_MS,
          answer: pick.name,
          points,
          ...(won ? { winner: PLAYER_ID } : {})
        });
        later(REVEAL_MS, () => {
          match.nextRound();
        });
      }
    } as const;

    queueMicrotask(emit);
    return {
      userId: PLAYER_ID,
      imageUrl: (key) => images.get(key) ?? '',
      send(command): void {
        if (closed) return;
        if (command.type === 'start') {
          if (phase !== 'lobby' && phase !== 'final') return;
          score = 0;
          round = 0;
          picks = shuffled(pool).slice(0, ROUNDS);
          match.nextRound();
          return;
        }
        const pick = picks[round - 1];
        if (phase !== 'round' || pick === undefined) return;
        const text = command.text.trim();
        if (text.toLowerCase() === pick.name.toLowerCase()) {
          match.reveal(pick, true);
          return;
        }
        const shared = Array.from(text).slice(0, MAX_SHARED_GUESS_CHARS).join('');
        // A wrong name already on the list is not added again, like the server.
        if (!guesses.some((earlier) => earlier.text.toLowerCase() === shared.toLowerCase())) {
          guesses = [...guesses, { id: PLAYER_ID, text: shared }].slice(-MAX_SHARED_GUESSES);
          emitRound(pick);
        }
        events.onMessage({ type: 'wrong' });
      },
      close(): void {
        closed = true;
        clearTimeout(timer);
      }
    };
  };
}
