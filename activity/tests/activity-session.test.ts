// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { requireValue } from '../src/validation.ts';
import { click, element, input, sdk, serverEmote, waitForText } from './fixtures/activity-page.ts';

test.each([
  { payload: null, sdkFailure: false },
  { payload: { accessToken: '', expiresIn: 3600 }, sdkFailure: false },
  { payload: { accessToken: 'session', expiresIn: 0 }, sdkFailure: false },
  { payload: { accessToken: 'session', expiresIn: 3600 }, sdkFailure: true }
])(
  'recovers after rejected session initialization: %j',
  async ({ payload, sdkFailure }: Readonly<{ payload: unknown; sdkFailure: boolean }>) => {
    vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
    vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
    sdk.ready.mockResolvedValue();
    sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
    if (sdkFailure)
      sdk.commands.authenticate.mockRejectedValueOnce(new Error('Rejected')).mockResolvedValue({});
    let exchanges = 0;
    let catalogRequests = 0;
    const fetch = vi.fn((path: string) => {
      if (path === '/botge-api/auth') {
        exchanges += 1;
        return Response.json(
          exchanges === 1 ? payload : { accessToken: 'session', expiresIn: 3600 }
        );
      }
      catalogRequests += 1;
      return Response.json({ canManageEmotes: true, emotes: [serverEmote] });
    });
    vi.stubGlobal('fetch', fetch);
    await import('../src/index.ts');
    await waitForText('#message', 'Could not load server emotes.');
    expect(catalogRequests).toBe(0);
    click('#refresh-catalog');
    await waitForText('#message', 'Showing 1 of 1');
    expect(exchanges).toBe(2);
    expect(catalogRequests).toBe(1);
  }
);

test('releases the API queue after stalled authorization and ignores its late result', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'true');
  sdk.ready.mockResolvedValue();
  let finishAuthorization: ((value: Readonly<{ code: string }>) => void) | undefined;
  sdk.commands.authorize
    .mockImplementationOnce(
      async () =>
        await new Promise<Readonly<{ code: string }>>((resolve) => {
          finishAuthorization = resolve;
        })
    )
    .mockResolvedValue({ code: 'recovered-code' });
  const fetch = vi.fn((path: string) =>
    path === '/botge-api/auth' ? Response.json({ accessToken: 'access-token', expiresIn: 3600 })
    : path === '/botge-api/settings' ?
      Response.json({
        voice: { channelId: '42', statusEnabled: false, statusEmoji: null },
        channels: [{ id: '42', name: 'Voice' }]
      })
    : Response.json([])
  );
  vi.stubGlobal('fetch', fetch);
  await import('../src/index.ts');
  await vi.waitFor(() => {
    expect(element('#voice-settings').hidden).toBe(false);
  });
  vi.useFakeTimers();
  try {
    const border = requireValue(
      document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
      'Missing border settings'
    );
    const voice = requireValue(
      document.querySelector<HTMLDetailsElement>('#voice-settings'),
      'Missing voice settings'
    );
    border.open = true;
    await vi.advanceTimersByTimeAsync(1);
    voice.open = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(sdk.commands.authorize).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(element('#emote-border-settings [role="status"]').textContent).toContain(
      'Discord did not respond'
    );
    expect(border.hasAttribute('aria-busy')).toBe(false);
    expect(voice.hasAttribute('aria-busy')).toBe(false);
    expect(input('#voice-status-enabled').checked).toBe(false);
    expect(sdk.commands.authorize).toHaveBeenCalledTimes(2);
    finishAuthorization?.({ code: 'late-code' });
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test('reports stalled SDK readiness instead of loading forever', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  sdk.ready.mockImplementation(async () => {
    await new Promise<void>(() => {
      // Model a Discord SDK command that never responds.
    });
  });
  vi.useFakeTimers();
  try {
    await import('../src/index.ts');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(element('#message').textContent).toContain('Reopen the Activity');
    expect(sdk.commands.authorize).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
