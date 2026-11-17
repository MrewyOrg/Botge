// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { click, element, sdk, waitForText } from './fixtures/activity-page.ts';

test('uses the demo when the curated catalog is empty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])));
  await import('../src/index.ts');
  await waitForText('#results', 'Botge');
  expect(element('#results').textContent).toContain('Demo');
});

test('reports a failed curated catalog load', async () => {
  const error = vi.spyOn(console, 'error').mockReturnValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await import('../src/index.ts');
  await waitForText('#message', 'Could not load emotes');
  expect(error).toHaveBeenCalledOnce();
});

/** Plays the game server's part of the room connection. */
class FakeSocket extends EventTarget {
  public static readonly OPEN = 1 as const;
  public static last: FakeSocket | undefined;
  public readonly sent: string[] = [];
  public readyState = 0;

  public constructor() {
    super();
    FakeSocket.last = this;
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.readyState = 3;
  }

  public accept(players: readonly string[]): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
    const state = {
      phase: 'lobby',
      round: 0,
      rounds: 0,
      roundMs: 20_000,
      players: players.map((id) => ({ id, score: 0 })),
      guesses: []
    } as const;
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ type: 'state', state }) })
    );
  }
}

/** Opens the Guess tab inside Discord and returns the join request bodies. */
async function openGame(): Promise<readonly unknown[]> {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_GAME', 'true');
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.last = undefined;
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const joins: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: Readonly<{ body?: string }>) => {
      if (path === '/botge-api/auth')
        return Response.json({ accessToken: 'session', expiresIn: 3600 });
      if (path === '/botge-api/game/join') {
        joins.push(JSON.parse(init?.body ?? 'null') as unknown);
        return Response.json({ ticket: 'ticket-1', userId: '42' });
      }
      return Response.json([]);
    })
  );
  await import('../src/index.ts');
  await vi.waitFor(() => {
    expect(element('#game-link').hidden).toBe(false);
  });
  click('#game-link');
  await vi.waitFor(() => {
    expect(FakeSocket.last).toBeDefined();
  });
  return joins;
}

test('names the players of a Discord game room from the participant list', async () => {
  let announce: Parameters<typeof sdk.subscribe>[1] | undefined;
  sdk.subscribe.mockImplementation(async (_event, listener) => {
    announce = listener;
    await Promise.resolve();
  });
  sdk.commands.getInstanceConnectedParticipants.mockResolvedValue({
    participants: [
      { id: '42', username: 'user42', global_name: 'Global', nickname: 'Nick' },
      { id: '7', username: 'seven', global_name: null },
      { id: '8', username: 'eight', global_name: 'Eight' }
    ]
  });
  const joins = await openGame();
  expect(joins).toEqual([expect.objectContaining({ instanceId: 'i-1-gc-1-2' })]);
  expect(sdk.subscribe).toHaveBeenCalledWith(
    'ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE',
    expect.any(Function)
  );

  FakeSocket.last?.accept(['42', '7', '8', '1239']);
  const players = element('#game-players');
  await waitForText('#game-players', 'Nick');
  expect(players.textContent).toContain('seven');
  expect(players.textContent).toContain('Eight');
  expect(players.textContent).toContain('Player 1239');

  announce?.({ participants: [{ id: '1239', username: 'late' }] });
  await waitForText('#game-players', 'late');
  expect(players.textContent).not.toContain('Nick');
});

test('keeps the game usable when Discord withholds the participant list', async () => {
  const error = vi.spyOn(console, 'error').mockReturnValue(undefined);
  sdk.subscribe.mockResolvedValue();
  sdk.commands.getInstanceConnectedParticipants.mockRejectedValue(new Error('Denied'));
  await openGame();
  FakeSocket.last?.accept(['42']);
  await waitForText('#game-players', 'Player 42');
  expect(error).toHaveBeenCalledOnce();
});
