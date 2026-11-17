import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { connectDemoGame, type DemoGameEmote, maskName } from '../../src/demo/demo-game.ts';
import type { GameConnection, GameMessage, GameState } from '../../src/game/game-state.ts';
import { requireValue } from '../../src/validation.ts';

const pool: readonly DemoGameEmote[] = Array.from({ length: 12 }, (_, index) => ({
  name: `Emote${index}`,
  image: `/art/${index}.svg`
}));

async function play(): Promise<{
  readonly connection: GameConnection;
  readonly messages: readonly GameMessage[];
  readonly last: () => GameState;
  /** Finds the answer through the image, as only the demo's own data allows. */
  readonly answer: () => string;
}> {
  const messages: GameMessage[] = [];
  const connection = await connectDemoGame(pool)({
    onMessage(message): void {
      messages.push(message);
    },
    onClose: () => undefined
  });
  await vi.advanceTimersByTimeAsync(0);
  const last = (): GameState =>
    requireValue(
      messages.findLast((entry) => entry.type === 'state'),
      'No state yet'
    ).state;
  return {
    connection,
    messages,
    last,
    answer(): string {
      const image = connection.imageUrl(requireValue(last().image, 'No round image'));
      return requireValue(
        pool.find((emote) => emote.image === image),
        'Unknown image'
      ).name;
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('masks names like the server', () => {
  expect(maskName('Botge', 0)).toBe('_____');
  expect(maskName('Botge', 10_000)).toBe('B____');
  expect(maskName('Botge', 19_000)).toBe('B____');
  expect(maskName('Sleepy', 9999)).toBe('______');
  expect(maskName('Sleepy', 15_000)).toBe('S__e__');
  expect(maskName('Hi', 19_000)).toBe('__');
  expect(maskName('two words', 15_000)).toBe('t__ w____');
});

test('holds a ready beat, then plays rounds with hints and scores earlier answers higher', async () => {
  const game = await play();
  expect(game.last()).toMatchObject({ phase: 'lobby', round: 0, players: [{ score: 0 }] });
  game.connection.send({ type: 'guess', text: 'early' });
  expect(game.messages).toHaveLength(1);

  game.connection.send({ type: 'start' });
  expect(game.last()).toMatchObject({ phase: 'ready', round: 1, rounds: 10, remainingMs: 3000 });
  expect(game.last().image).not.toContain('Emote');
  expect(game.last().hint).toBeUndefined();
  const first = game.answer();
  // Guesses and a second start are ignored until the round opens.
  game.connection.send({ type: 'guess', text: first });
  game.connection.send({ type: 'start' });
  expect(game.last().phase).toBe('ready');

  await vi.advanceTimersByTimeAsync(3000);
  expect(game.last()).toMatchObject({ phase: 'round', round: 1, remainingMs: 20_000 });
  expect(game.last().hint).toBe('_'.repeat(first.length));
  expect(game.last().answer).toBeUndefined();

  game.connection.send({ type: 'guess', text: ` ${'x'.repeat(50)} ` });
  expect(game.messages.at(-1)).toEqual({ type: 'wrong' });
  expect(game.last().guesses).toEqual([{ id: 'demo-player', text: 'x'.repeat(40) }]);
  // Repeating a wrong name still counts as wrong but is listed once.
  const listed = game.messages.length;
  game.connection.send({ type: 'guess', text: 'X'.repeat(40) });
  expect(game.messages.slice(listed)).toEqual([{ type: 'wrong' }]);
  for (let number = 0; number < 8; number += 1)
    game.connection.send({ type: 'guess', text: `wrong${number}` });
  expect(game.last().guesses).toHaveLength(8);
  expect(game.last().guesses.at(0)?.text).toBe('wrong0');

  await vi.advanceTimersByTimeAsync(10_000);
  expect(game.last().hint).toBe(`E${'_'.repeat(first.length - 1)}`);
  expect(game.last().remainingMs).toBe(10_000);
  await vi.advanceTimersByTimeAsync(1000);
  game.connection.send({ type: 'guess', text: `  ${first.toUpperCase()} ` });
  expect(game.last()).toMatchObject({
    phase: 'reveal',
    answer: first,
    winner: 'demo-player',
    points: 2,
    remainingMs: 5000,
    players: [{ id: 'demo-player', score: 2 }]
  });
  expect(game.last().guesses).toHaveLength(8);

  await vi.advanceTimersByTimeAsync(5000);
  expect(game.last()).toMatchObject({ phase: 'ready', round: 2, guesses: [] });
  const second = game.answer();
  expect(second).not.toBe(first);
  await vi.advanceTimersByTimeAsync(3000 + 15_000);
  // Seven-letter names show two letters; six-letter names show them too.
  expect(game.last().hint?.replaceAll('_', '')).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(5000);
  expect(game.last()).toMatchObject({ phase: 'reveal', answer: second, points: 0 });
  expect(game.last().winner).toBeUndefined();
});

test('ends after ten rounds, resets the score for a new match, and stops when closed', async () => {
  const game = await play();
  game.connection.send({ type: 'start' });
  const seen = new Set<string>();
  for (let round = 1; round <= 10; round += 1) {
    await vi.advanceTimersByTimeAsync(3000);
    expect(game.last()).toMatchObject({ phase: 'round', round });
    seen.add(game.answer());
    game.connection.send({ type: 'guess', text: game.answer() });
    await vi.advanceTimersByTimeAsync(5000);
  }
  expect(seen.size).toBe(10);
  expect(game.last()).toMatchObject({ phase: 'final', players: [{ score: 40 }], guesses: [] });
  expect(game.last().image).toBeUndefined();

  game.connection.send({ type: 'start' });
  expect(game.last()).toMatchObject({ phase: 'ready', round: 1, players: [{ score: 0 }] });
  const before = game.messages.length;
  game.connection.close();
  game.connection.send({ type: 'guess', text: 'ignored' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(game.messages).toHaveLength(before);
  expect(game.connection.imageUrl('missing')).toBe('');
});
