// @vitest-environment jsdom

import { afterEach, beforeEach, expect, type MockInstance, test, vi } from 'vitest';

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

// jsdom does not scroll; the stub records the stage being brought into view.
let scrolled: MockInstance<typeof window.scrollBy>;

beforeEach(() => {
  scrolled = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  element('#activity-game').hidden = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('game-keyboard');
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
  // Opening the page centers the start button once the lobby shows it.
  expect(scrolled).toHaveBeenCalledTimes(1);

  const start = control('#game-start', HTMLButtonElement);
  expect(start.hidden).toBe(false);
  start.click();
  expect(game.sent).toEqual([{ type: 'start' }]);
  expect(start.disabled).toBe(true);
  // Focus inside the tap is what lets mobile browsers open the keyboard for the round.
  expect(document.activeElement).toBe(control('#game-guess', HTMLInputElement));

  game.emit(state({ notice: 'Add more emotes.', players: [{ id: 'me', score: 0 }] }));
  expect(element('#game-status').textContent).toBe('Add more emotes.');
  expect(start.disabled).toBe(false);
  game.emit(state({ phase: 'loading' }));
  expect(element('#game-status').textContent).toBe('Picking emotes…');
  expect(start.hidden).toBe(true);
  // The match hides the intro and scrolls the fitted stage just below the top bar.
  expect(element('#activity-game').classList.contains('playing')).toBe(true);
  expect(scrolled).toHaveBeenCalledTimes(2);
});

test('compacts the stage for the keyboard only on touch screens with the guess focused', async () => {
  const keyboard = (): boolean => document.documentElement.classList.contains('game-keyboard');
  for (const touch of [true, false] as const) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: touch && query.includes('coarse')
    }));
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    element('#activity-game').hidden = false;
    const game = room();
    game.view.open();
    await Promise.resolve();
    game.emit(state({ phase: 'round', image: 'abc', remainingMs: 10_000 }));

    const guess = control('#game-guess', HTMLInputElement);
    expect(document.activeElement).toBe(guess);
    expect(keyboard()).toBe(touch);
    guess.blur();
    expect(keyboard()).toBe(false);
    document.documentElement.classList.remove('game-keyboard');
  }
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
  // A blank guess is not sent and keeps what was typed.
  expect(guess.value).toBe('   ');
  guess.value = ' wave ';
  form.requestSubmit();
  expect(game.sent).toEqual([{ type: 'guess', text: 'wave' }]);
  // A sent guess empties the box and keeps focus there for the next try.
  expect(guess.value).toBe('');
  expect(document.activeElement).toBe(guess);
  // Pressing Guess does not move focus, which would close a phone's keyboard.
  const press = new Event('pointerdown', { cancelable: true });
  requireValue(form.querySelector('button'), 'Missing guess button').dispatchEvent(press);
  expect(press.defaultPrevented).toBe(true);

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

test('clears an unfinished guess when the round ends', async () => {
  const game = room();
  game.view.open();
  await Promise.resolve();
  game.emit(state({ phase: 'round', image: 'abc', remainingMs: 10_000 }));
  const guess = control('#game-guess', HTMLInputElement);
  guess.value = 'half typ';
  game.emit(state({ phase: 'reveal', answer: 'Wave' }));
  expect(guess.value).toBe('');
  // The input stays on screen between rounds, so a phone keeps its keyboard open.
  expect(element('#game-form').hidden).toBe(false);
});

/** Places an element at `top` so the scroll it causes is unique to this page. */
function place(selector: string, top: number, height = 40): void {
  vi.spyOn(element(selector), 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, top, 100, height)
  );
}

test('refits the stage to the visible height and keeps it in view on a resize', async () => {
  const game = room();
  game.view.open();
  await Promise.resolve();
  game.emit(state({ phase: 'round', image: 'abc', remainingMs: 10_000 }));
  const page = element('#activity-game');
  place('.game-stage', 300);
  // Just below the top bar: the stage's top less the 8-pixel gap.
  const toStage = { top: 292, behavior: 'instant' } as const;

  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(420);
  window.dispatchEvent(new Event('resize'));
  expect(page.style.getPropertyValue('--game-space')).toBe('420px');
  expect(scrolled).toHaveBeenCalledWith(toStage);

  // Outside a match a resize refits but leaves the scroll position alone.
  game.emit(state({ phase: 'final', players: [{ id: 'me', score: 0 }] }));
  scrolled.mockClear();
  window.dispatchEvent(new Event('resize'));
  expect(scrolled).not.toHaveBeenCalledWith(toStage);
});

test('reopening the page returns to a running match or centers the start button', async () => {
  const game = room();
  game.view.open();
  await Promise.resolve();
  game.emit(state({}));
  const page = element('#activity-game');
  place('#game-start', 600);
  place('.game-stage', 300);
  // The start button's middle (620) moves to the middle of jsdom's 768-pixel window.
  const toStart = { top: 236, behavior: 'instant' } as const;
  const toStage = { top: 292, behavior: 'instant' } as const;

  // The lobby's start button is already showing, so it is centered at once.
  scrolled.mockClear();
  game.view.open();
  expect(scrolled).toHaveBeenCalledWith(toStart);

  game.emit(state({ phase: 'round', image: 'abc', remainingMs: 10_000 }));
  scrolled.mockClear();
  game.view.open();
  expect(scrolled).toHaveBeenCalledWith(toStage);

  // A hidden page never scrolls the document.
  page.hidden = true;
  scrolled.mockClear();
  game.view.open();
  window.dispatchEvent(new Event('resize'));
  game.emit(state({}));
  expect(scrolled).not.toHaveBeenCalledWith(toStage);
  expect(scrolled).not.toHaveBeenCalledWith(toStart);
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
  expect(element('#game-form').hidden).toBe(false);
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
  expect(element('#game-form').hidden).toBe(false);
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
