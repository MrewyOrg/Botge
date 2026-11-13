// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { requireValue } from '../../src/validation.ts';
import { click, element, input, sdk, waitForText } from '../fixtures/activity-page.ts';

test('loads and saves voice settings through the Discord Activity API', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'true');
  sdk.ready.mockResolvedValue();
  let issuedCodes = 0;
  sdk.commands.authorize.mockImplementation(async () => {
    issuedCodes += 1;
    return await Promise.resolve({ code: `oauth-code-${issuedCodes}` });
  });

  const voice = { channelId: '42', statusEnabled: true, statusEmoji: '<:Botge:123>' };
  const channels = [{ id: '42', name: 'Voice channel' }];
  const disconnected = { channelId: null, statusEnabled: false, statusEmoji: '<:Botge:123>' };
  const borderBodies: string[] = [];
  const fetch = vi.fn(
    (path: string, init: Readonly<{ body: string; headers: Readonly<Record<string, string>> }>) => {
      if (path === '/botge-api/auth')
        return Response.json({ accessToken: `access-token-${issuedCodes}`, expiresIn: 3600 });
      if (path === '/botge-api/settings/border/read') {
        borderBodies.push(JSON.stringify([init.body, init.headers['Authorization']]));
        return borderBodies.length === 1 ?
            Response.json({ code: 'oauth_expired', message: 'Expired' }, { status: 401 })
          : Response.json({ color: 'FF7700' });
      }
      if (path === '/botge-api/settings') return Response.json({ voice, channels });
      if (path === '/botge-api/settings/voice')
        return Response.json({ voice: disconnected, channels });
      return Response.json([]);
    }
  );
  vi.stubGlobal('fetch', fetch);

  await import('../../src/index.ts');
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#voice-settings'),
    'Missing settings'
  );
  const channel = requireValue(
    document.querySelector<HTMLSelectElement>('#voice-channel'),
    'Missing channel'
  );
  await vi.waitFor(() => {
    expect(panel.hidden).toBe(false);
  });
  click('#settings-link');
  expect(element('#catalog-page').hidden).toBe(true);
  expect(element('#composer-pane').hidden).toBe(true);
  expect(element('#activity-settings').hidden).toBe(false);
  window.dispatchEvent(new Event('hashchange'));
  requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
    'Missing border'
  ).open = true;
  panel.open = true;
  await vi.waitFor(() => {
    expect(channel.value).toBe('42');
    expect(input('#emote-border-settings input[type="color"]').value).toBe('#ff7700');
  });
  expect(borderBodies).toHaveLength(2);
  expect(new Set(borderBodies).size).toBe(2);
  expect(sdk.commands.authorize).toHaveBeenCalledTimes(2);

  channel.value = '';
  input('#voice-status-enabled').checked = false;
  click('#voice-settings button');
  await waitForText('#voice-feedback', 'Saved.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/settings/voice',
    expect.objectContaining({
      body: JSON.stringify({ voice: disconnected, guildId: sdk.guildId })
    }) as unknown
  );
  expect(input('#voice-status-emoji').value).toBe('<:Botge:123>');
  click('#voice-settings button');
  await waitForText('#voice-feedback', 'Saved.');
  expect(sdk.commands.authorize).toHaveBeenCalledTimes(2);
  expect(sdk.commands.authenticate).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith(
    '/botge-api/settings/voice',
    expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer access-token-2' }
    }) as unknown
  );
  // Renew before expiry even when Discord has not returned a 401.
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 3_600_000);
  click('#voice-settings button');
  await waitForText('#voice-feedback', 'Saved.');
  expect(sdk.commands.authorize).toHaveBeenCalledTimes(3);
  expect(sdk.commands.authenticate).toHaveBeenCalledTimes(3);
  click('#catalog-link');
  expect(element('#catalog-page').hidden).toBe(false);
  expect(element('#activity-settings').hidden).toBe(true);
});

test('does not retry a non-401 response carrying an OAuth error marker', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const fetch = vi.fn((path: string) =>
    path === '/botge-api/auth' ? Response.json({ accessToken: 'access-token', expiresIn: 3600 })
    : path.startsWith('/botge-api/') ?
      Response.json({ code: 'oauth_expired', message: 'Upstream failed.' }, { status: 502 })
    : Response.json([])
  );
  vi.stubGlobal('fetch', fetch);
  await import('../../src/index.ts');
  await vi.waitFor(() => {
    expect(element('#voice-settings').hidden).toBe(false);
  });
  requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
    'Missing border settings'
  ).open = true;
  await waitForText('#emote-border-settings [role="status"]', 'Upstream failed.');
  expect(sdk.commands.authorize).toHaveBeenCalledOnce();
});

test('loads and saves emote settings through the route-specific API', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const saved = {
    sevenTvSet: null,
    bttvTwitchId: null,
    ffzChannel: null,
    allowEveryone: true,
    allowedRoles: [],
    roles: []
  };
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'session', expiresIn: 3600 });
    if (path.startsWith('/botge-api/settings/emotes')) return Response.json(saved);
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);
  await import('../../src/index.ts');
  await vi.waitFor(() => {
    expect(element('#emote-settings').hidden).toBe(false);
  });
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-settings'),
    'Missing emote settings'
  );
  panel.open = true;
  await vi.waitFor(() => {
    expect(panel.querySelector('fieldset')?.disabled).toBe(false);
  });
  requireValue(panel.querySelector('form'), 'Missing emote settings form').dispatchEvent(
    new Event('submit', { cancelable: true })
  );
  await waitForText('#emote-settings [role="status"]', 'Saved.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/settings/emotes',
    expect.objectContaining({
      body: JSON.stringify({
        emotes: {
          sevenTvSet: null,
          bttvTwitchId: null,
          ffzChannel: null,
          allowEveryone: true,
          allowedRoles: []
        },
        guildId: sdk.guildId
      })
    }) as unknown
  );
});
