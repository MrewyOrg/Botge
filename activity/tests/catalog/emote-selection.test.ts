// @vitest-environment jsdom

import type { DeepReadonly } from 'ts-essentials';
import { expect, test, vi } from 'vitest';

import {
  click,
  discoveryId,
  element,
  emoteId,
  input,
  sdk,
  serverEmote,
  waitForText
} from '../fixtures/activity-page.ts';

test('selects several emotes and uses bulk composer and server actions', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });

  const nextId = '01234567890123456789012347';
  const ids = [discoveryId, nextId];
  let entries = [serverEmote];
  let updates = 0;
  const additions = ids.map((id, index) => ({
    ...serverEmote,
    name: `Discovered${index}`,
    composeToken: `Discovered${index}`,
    sevenTVId: id,
    image: `/7tv-cdn/emote/${id}/2x.webp`
  }));
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    if (path === '/botge-api/catalog')
      return Response.json({ canManageEmotes: true, canComposeDiscovery: true, emotes: entries });
    if (path === '/botge-api/emotes/batch') {
      updates += 1;
      if (updates === 1) {
        entries = [serverEmote, ...additions.slice(0, 1)];
        return Response.json([
          { emoteId: discoveryId, ok: true },
          { emoteId: nextId, ok: false, message: '7TV temporarily unavailable.' }
        ]);
      }
      if (updates === 2) {
        entries = [serverEmote, ...additions];
        return Response.json([{ emoteId: nextId, ok: true }]);
      }
      entries = [serverEmote];
      return Response.json(ids.map((id) => ({ emoteId: id, ok: true })));
    }
    return Response.json({
      data: {
        emotes: {
          search: {
            pageCount: 1,
            items: ids.map((id, index) => ({
              id,
              defaultName: `Discovered${index}`,
              flags: { animated: false, nsfw: false, private: false, publicListed: true },
              images: [{ url: `https://cdn.7tv.app/emote/${id}/2x.webp` }]
            }))
          }
        }
      }
    });
  });
  vi.stubGlobal('fetch', fetch);
  await import('../../src/index.ts');
  await waitForText('#results', 'Wave');
  click('#top-mode');
  await waitForText('#results', 'Discovered1');
  click('#select-emotes');
  for (const item of document.querySelectorAll<HTMLButtonElement>('#results button')) item.click();
  expect(element('#selection-status').textContent).toBe('2 of 12 selected');
  click('#selection-compose');
  expect(input('#composer-input').value).toBe(ids.map((id) => `7tv:${id}`).join(' '));
  click('#selection-add');
  await waitForText('#selection-status', 'Added 1 of 2. 7TV temporarily unavailable.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes/batch',
    expect.objectContaining({
      body: JSON.stringify({ action: 'add', emoteIds: ids, guildId: sdk.guildId })
    }) as unknown
  );
  click('#selection-add');
  await waitForText('#selection-status', 'Added 1 of 1');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes/batch',
    expect.objectContaining({
      body: JSON.stringify({ action: 'add', emoteIds: [nextId], guildId: sdk.guildId })
    }) as unknown
  );
  await waitForText('#message', 'Showing 2 7TV emotes');
  click('#catalog-mode');
  await waitForText('#results', 'Discovered1');
  click('#results li:nth-child(2) button');
  click('#results li:nth-child(3) button');
  click('#selection-remove');
  await waitForText('#selection-status', 'Removed 2 of 2');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes/batch',
    expect.objectContaining({
      body: JSON.stringify({ action: 'remove', emoteIds: ids, guildId: sdk.guildId })
    }) as unknown
  );
  expect(updates).toBe(3);
  expect(document.querySelectorAll('#results li')).toHaveLength(1);
  click('#selection-clear');
  click('#select-emotes');
  expect(element('#selection').hidden).toBe(true);
});

test.each([
  { payload: { message: 'Permission denied.' }, expected: 'Permission denied.' },
  { payload: null, expected: 'Invalid bulk emote response.' },
  {
    payload: [
      null,
      { emoteId: 42 },
      { emoteId: 'another-emote', ok: true },
      { emoteId, ok: false }
    ],
    expected: 'Removed 0 of 1.'
  }
])(
  'preserves the selection after malformed or denied bulk results: $expected',
  async ({ payload, expected }: DeepReadonly<{ payload: unknown; expected: string }>) => {
    vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
    vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
    sdk.ready.mockResolvedValue();
    sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
    vi.stubGlobal(
      'fetch',
      vi.fn((path: string) => {
        if (path === '/botge-api/auth')
          return Response.json({ accessToken: 'session', expiresIn: 3600 });
        if (path === '/botge-api/emotes/batch') return Response.json(payload);
        return Response.json({ canManageEmotes: true, emotes: [serverEmote] });
      })
    );
    await import('../../src/index.ts');
    await waitForText('#message', 'Showing 1 of 1');
    click('#select-emotes');
    click('#results button');
    click('#selection-remove');
    await waitForText('#selection-status', expected);
    expect(element('#results button').getAttribute('aria-pressed')).toBe('true');
  }
);
