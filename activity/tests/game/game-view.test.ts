// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import type {
  GameCommand,
  GameConnection,
  GameEvents,
  GameMessage,
  GameState
} from '../../src/game/game-state.ts';
import { blurAt, mountGame } from '../../src/game/game-view.ts';
import { requireValue } from '../../src/validation.ts';

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

function control<T extends HTMLElement>(selector: string, kind: abstract new () => T): T {
  const found = document.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`Missing ${selector}`);
  return found;
}

function state(fields: Partial<GameState>): GameMessage {
  return {
    type: 'state',
    state: {
      phase: 'lobby',
      round: 0,
      rounds: 0,
      roundMs: 20_000,
      players: [
        { id: 'me', score: 0 },
        { id: '1234567890', score: 0 }
      ],
      guesses: [],
      ...fields
    }
  };
}

/** A room the test drives by hand. */
function room(): {
  readonly sent: readonly GameCommand[];
  /** Each change between an idle room and a running match, in order. */
  readonly playing: readonly boolean[];
  readonly connects: () => number;
  readonly emit: (message: GameMessage) => void;
  readonly drop: () => void;
  /** Makes later joins fail, as when the network is down. */
  readonly refuse: (refusing: boolean) => void;
  readonly view: ReturnType<typeof mountGame>;
} {
  const sent: GameCommand[] = [];
  const playing: boolean[] = [];
  let events: GameEvents | undefined;
  let connects = 0;
  let refusing = false;
  const view = mountGame({
    async connect(opened): Promise<GameConnection> {
      await Promise.resolve();
      connects += 1;
      if (refusing) throw new Error('Offline.');
      events = opened;
      return {
        userId: 'me',
        imageUrl: (token) => `/image/${token}`,
        send(command): void {
          sent.push(command);
        },
        close(): void {
          events = undefined;
        }
      };
    },
    playerName: (id) => (id === '1234567890' ? 'Ada' : undefined),
    onPlaying(now): void {
      playing.push(now);
    }
  });
  return {
    sent,
    playing,
    connects: () => connects,
    emit(message): void {
      requireValue(events, 'Not connected').onMessage(message);
    },
    drop(): void {
      requireValue(events, 'Not connected').onClose();
    },
    refuse(now): void {
      refusing = now;
    },
    view
  };
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  element('#activity-game').hidden = false;
});

afterEach(() => {
  vi.useRealTimers();
});

test('sharpens from the start blur to the end blur over the round', () => {
  expect(blurAt(20_000, 20_000)).toBe(28);
  expect(blurAt(10_000, 20_000)).toBe(15.5);
  expect(blurAt(0, 20_000)).toBe(3);
  expect(blurAt(30_000, 20_000)).toBe(28);
  expect(blurAt(5, 0)).toBe(3);
});

test('joins once, shows the lobby, and starts a match on request', async () => {
  const game = room();
  game.view.open();
  game.view.open();
  expect(element('#game-status').textContent).toBe('Joining the game…');
  await vi.waitFor(() => {
    expect(game.connects()).toBe(1);
  });
  game.emit(state({}));
  expect(element('#game-status').textContent).toBe('2 players are here. Anyone can start.');
  expect(
    [...element('#game-players').children].map(
      (row: Readonly<Pick<Element, 'textContent'>>) => row.textContent
    )
  ).toEqual(['You0', 'Ada0']);
  expect(element('#game-players').firstElementChild?.classList.contains('self')).toBe(true);
  expect(element('#game-form').hidden).toBe(true);

  const start = control('#game-start', HTMLButtonElement);
  expect(start.hidden).toBe(false);
  start.click();
  expect(game.sent).toEqual([{ type: 'start' }]);
  expect(start.disabled).toBe(true);

  game.emit(state({ notice: 'Add more emotes.', players: [{ id: 'me', score: 0 }] }));
  expect(element('#game-status').textContent).toBe('Add more emotes.');
  expect(start.disabled).toBe(false);
  game.emit(state({ phase: 'loading' }));
  expect(element('#game-status').textContent).toBe('Picking emotes…');
  expect(start.hidden).toBe(true);
});

test('blurs the round image, sends guesses, and flashes a wrong one', async () => {
  vi.useFakeTimers();
  const game = room();
  game.view.open();
  await vi.advanceTimersByTimeAsync(0);
  game.emit(state({ phase: 'round', round: 3, rounds: 10, image: 'abc', remainingMs: 10_000 }));

  const image = control('#game-image', HTMLImageElement);
  expect(image.hidden).toBe(false);
  expect(image.getAttribute('src')).toBe('/image/abc');
  expect(image.style.filter).toBe('blur(3px)');
  expect(image.style.transition).toBe('filter 10000ms linear');
  expect(element('#game-timer').style.transform).toBe('scaleX(0)');
  expect(element('#game-round').textContent).toBe('Round 3 of 10');
  const guess = control('#game-guess', HTMLInputElement);
  expect(document.activeElement).toBe(guess);

  const form = control('#game-form', HTMLFormElement);
  guess.value = '   ';
  form.requestSubmit();
  guess.value = ' wave ';
  form.requestSubmit();
  expect(game.sent).toEqual([{ type: 'guess', text: 'wave' }]);

  game.emit({ type: 'wrong' });
  expect(guess.classList.contains('wrong')).toBe(true);
  await vi.advanceTimersByTimeAsync(400);
  expect(guess.classList.contains('wrong')).toBe(false);

  // A later state in the same round keeps the typed guess and the loaded image.
  guess.value = 'typing';
  game.emit(state({ phase: 'round', round: 3, rounds: 10, image: 'abc', remainingMs: 4000 }));
  expect(guess.value).toBe('typing');
  expect(image.style.transition).toBe('filter 4000ms linear');
});

test('reveals the answer, names the winner, and offers another match', async () => {
  const game = room();
  game.view.open();
  await vi.waitFor(() => {
    expect(game.connects()).toBe(1);
  });
  const reveal = { phase: 'reveal', round: 1, rounds: 2, image: 'abc', answer: 'Wave' } as const;
  game.emit(state({ ...reveal, winner: 'me', points: 4 }));
  expect(element('#game-status').textContent).toBe('You got it: Wave (+4).');
  expect(control('#game-image', HTMLImageElement).style.filter).toBe('none');
  expect(element('#game-form').hidden).toBe(true);
  expect(element('#game-timer').hidden).toBe(true);

  game.emit(state({ ...reveal, winner: '1234567890', points: 1 }));
  expect(element('#game-status').textContent).toBe('Ada got it: Wave (+1).');
  game.emit(state({ ...reveal, winner: '99998888', points: 2 }));
  expect(element('#game-status').textContent).toBe('Player 8888 got it: Wave (+2).');
  game.emit(state({ ...reveal, points: 0 }));
  expect(element('#game-status').textContent).toBe('Time is up. It was Wave.');

  const final = { phase: 'final', round: 2, rounds: 2 } as const;
  for (const [players, expected] of [
    [[{ id: 'me', score: 5 }], 'Match over. You win.'],
    [
      [
        { id: '1234567890', score: 5 },
        { id: 'me', score: 2 }
      ],
      'Match over. Ada wins.'
    ],
    [
      [
        { id: '1234567890', score: 5 },
        { id: 'me', score: 5 }
      ],
      'Match over. It is a tie.'
    ],
    [[{ id: 'me', score: 0 }], 'Match over. Nobody scored.']
  ] as const) {
    game.emit(state({ ...final, players }));
    expect(element('#game-status').textContent).toBe(expected);
  }
  expect(control('#game-image', HTMLImageElement).hidden).toBe(true);
  expect(element('#game-start').textContent).toBe('Play again');
});

test('loads the image during the ready beat, then shows the hint and shared guesses', async () => {
  const game = room();
  game.view.open();
  await vi.waitFor(() => {
    expect(game.connects()).toBe(1);
  });
  const round = { round: 1, rounds: 2, image: 'abc' } as const;
  game.emit(state({ ...round, phase: 'ready', remainingMs: 3000 }));
  const image = control('#game-image', HTMLImageElement);
  expect(image.getAttribute('src')).toBe('/image/abc');
  expect(image.hidden).toBe(true);
  expect(element('#game-status').textContent).toBe('Get ready…');
  expect(element('#game-form').hidden).toBe(true);
  expect(element('#game-hint').hidden).toBe(true);
  expect(game.playing).toEqual([true]);

  const guesses = [
    { id: 'me', text: 'nope' },
    { id: '1234567890', text: 'wav' }
  ] as const;
  game.emit(state({ ...round, phase: 'round', remainingMs: 9000, hint: 'W___', guesses }));
  expect(image.hidden).toBe(false);
  expect(element('#game-hint').hidden).toBe(false);
  expect(element('#game-hint').textContent).toBe('W___');
  // The input accepts no more characters than the name has.
  expect(control('#game-guess', HTMLInputElement).maxLength).toBe(4);
  const shared = (): readonly (string | null)[] =>
    [...element('#game-guesses').children].map(
      (row: Readonly<Pick<Element, 'textContent'>>) => row.textContent
    );
  expect(shared()).toEqual(['You: nope', 'Ada: wav']);

  game.emit(state({ ...round, phase: 'reveal', answer: 'Wave', points: 0, guesses }));
  expect(element('#game-hint').hidden).toBe(true);
  expect(element('#game-hint').textContent).toBe('');
  expect(control('#game-guess', HTMLInputElement).maxLength).toBe(100);
  expect(shared()).toEqual(['You: nope', 'Ada: wav']);
  game.emit(state({ phase: 'final', round: 2, rounds: 2, guesses }));
  expect(shared()).toEqual([]);
});

test('reconnects on its own after a lost connection and keeps the room on screen', async () => {
  vi.useFakeTimers();
  const game = room();
  game.view.open();
  await vi.advanceTimersByTimeAsync(0);
  game.emit(state({ phase: 'round', round: 1, rounds: 2, image: 'abc', remainingMs: 1000 }));
  game.drop();
  expect(element('#game-status').textContent).toBe('Connection lost. Reconnecting…');
  expect(element('#game-form').hidden).toBe(true);
  expect(element('#game-start').hidden).toBe(true);
  expect(element('#game-players').children).toHaveLength(2);
  // Opening the page again does not start a second connection while one is scheduled.
  game.view.open();
  await vi.advanceTimersByTimeAsync(999);
  expect(game.connects()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(game.connects()).toBe(2);
  game.emit(state({ phase: 'round', round: 1, rounds: 2, image: 'abc', remainingMs: 500 }));
  expect(element('#game-form').hidden).toBe(false);
  expect(game.playing).toEqual([true]);
});

test('offers a button after three failed reconnects', async () => {
  vi.useFakeTimers();
  const game = room();
  game.view.open();
  await vi.advanceTimersByTimeAsync(0);
  game.emit(state({ phase: 'round', round: 1, rounds: 2, image: 'abc', remainingMs: 1000 }));
  game.refuse(true);
  game.drop();
  for (const [wait, connects] of [
    [1000, 2],
    [2000, 3],
    [4000, 4]
  ] as const) {
    expect(element('#game-status').textContent).toBe('Connection lost. Reconnecting…');
    await vi.advanceTimersByTimeAsync(wait);
    expect(game.connects()).toBe(connects);
  }
  expect(element('#game-status').textContent).toBe('The game connection closed.');
  expect(element('#game-players').children).toHaveLength(0);
  expect(element('#game-guesses').children).toHaveLength(0);
  expect(game.playing).toEqual([true, false]);
  const start = element('#game-start');
  expect(start.textContent).toBe('Reconnect');

  // The button starts a fresh count of automatic reconnects.
  game.refuse(false);
  start.click();
  await vi.advanceTimersByTimeAsync(0);
  expect(game.connects()).toBe(5);
  game.emit(state({}));
  game.drop();
  expect(element('#game-status').textContent).toBe('Connection lost. Reconnecting…');
});

test('does not reconnect when the room gave a reason for closing', async () => {
  vi.useFakeTimers();
  const game = room();
  game.view.open();
  await vi.advanceTimersByTimeAsync(0);
  game.emit({ type: 'error', message: 'The room is full.' });
  game.drop();
  expect(element('#game-status').textContent).toBe('The room is full.');
  expect(element('#game-start').textContent).toBe('Reconnect');
  await vi.advanceTimersByTimeAsync(10_000);
  expect(game.connects()).toBe(1);
  // Names redraw only while a room state is on screen.
  game.view.refresh();
  expect(element('#game-players').children).toHaveLength(0);
});

test('shows why joining failed', async () => {
  const view = mountGame({
    connect: async () => await Promise.reject(new Error('Open Botge inside Discord.')),
    playerName: () => undefined
  });
  view.open();
  await vi.waitFor(() => {
    expect(element('#game-status').textContent).toBe('Open Botge inside Discord.');
  });
  expect(element('#game-start').textContent).toBe('Reconnect');
});

test('reports when a match starts, ends, or loses its connection', async () => {
  const game = room();
  game.view.open();
  await vi.waitFor(() => {
    expect(game.connects()).toBe(1);
  });
  game.emit(state({}));
  expect(game.playing).toEqual([]);
  game.emit(state({ phase: 'loading' }));
  game.emit(state({ phase: 'round', round: 1, rounds: 1, image: 'abc', remainingMs: 1000 }));
  game.emit(state({ phase: 'reveal', round: 1, rounds: 1, image: 'abc', answer: 'Wave' }));
  expect(game.playing).toEqual([true]);
  game.emit(state({ phase: 'final', round: 1, rounds: 1 }));
  expect(game.playing).toEqual([true, false]);
  game.emit(state({ phase: 'loading' }));
  // A room that closes with a reason ends the match for this player.
  game.emit({ type: 'error', message: 'Closed.' });
  game.drop();
  expect(game.playing).toEqual([true, false, true, false]);
});
