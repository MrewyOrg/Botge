import { expect, test } from 'vitest';

import { parseGameMessage } from '../../src/game/game-state.ts';

const lobby = {
  phase: 'lobby',
  round: 0,
  rounds: 0,
  roundMs: 20_000,
  players: [{ id: '1', score: 0 }],
  guesses: []
} as const;

test('accepts each message type and keeps only known state fields', () => {
  expect(parseGameMessage({ type: 'wrong' })).toEqual({ type: 'wrong' });
  expect(parseGameMessage({ type: 'error', message: 'Full.' })).toEqual({
    type: 'error',
    message: 'Full.'
  });
  expect(parseGameMessage({ type: 'state', state: { ...lobby, extra: true } })).toEqual({
    type: 'state',
    state: lobby
  });
  // A state without shared guesses has none.
  const bare = { round: 0, rounds: 0, roundMs: 20_000, players: lobby.players } as const;
  expect(parseGameMessage({ type: 'state', state: { ...bare, phase: 'ready' } })).toEqual({
    type: 'state',
    state: { ...lobby, phase: 'ready' }
  });
  const reveal = {
    ...lobby,
    phase: 'reveal',
    round: 2,
    rounds: 10,
    image: 'token',
    remainingMs: 5000,
    answer: 'Wave',
    winner: '1',
    points: 3,
    notice: 'Note.',
    hint: 'W___',
    guesses: [{ id: '2', text: 'wav' }]
  } as const;
  expect(parseGameMessage({ type: 'state', state: reveal })).toEqual({
    type: 'state',
    state: reveal
  });
});

test('rejects unknown types and malformed states', () => {
  const invalid: readonly unknown[] = [
    undefined,
    'state',
    { type: 'other' },
    { type: 'error' },
    { type: 'state' },
    { type: 'state', state: { ...lobby, phase: 'paused' } },
    { type: 'state', state: { ...lobby, round: -1 } },
    { type: 'state', state: { ...lobby, roundMs: 1.5 } },
    { type: 'state', state: { ...lobby, players: 'none' } },
    { type: 'state', state: { ...lobby, players: [{ id: 1, score: 0 }] } },
    { type: 'state', state: { ...lobby, players: [{ id: '1', score: '0' }] } },
    { type: 'state', state: { ...lobby, answer: 5 } },
    { type: 'state', state: { ...lobby, hint: 5 } },
    { type: 'state', state: { ...lobby, guesses: 'none' } },
    { type: 'state', state: { ...lobby, guesses: [{ id: '1' }] } },
    { type: 'state', state: { ...lobby, remainingMs: 'soon' } }
  ] as const;
  for (const value of invalid) expect(parseGameMessage(value)).toBeUndefined();
});
