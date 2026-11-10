// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import html from '../index.html?raw';
import { requireValue } from '../src/validation.ts';

const sdk = vi.hoisted(() => ({
  guildId: '123456789012345678',
  ready: vi.fn<() => Promise<void>>(),
  commands: {
    authorize: vi.fn<() => Promise<{ code: string }>>(),
    openExternalLink: vi.fn<() => Promise<void>>()
  }
}));

vi.mock('@discord/embedded-app-sdk', () => ({
  DiscordSDK: vi.fn(function () {
    return sdk;
  })
}));

const emoteId = '01234567890123456789012345';
const discoveryId = '01234567890123456789012346';
const publicEmote = {
  name: 'Wave',
  source: '7TV',
  image: 'emotes/wave.webp',
  animated: false,
  tags: ['Greeting']
};
const serverEmote = {
  ...publicEmote,
  image: `/7tv-cdn/emote/${emoteId}/2x.webp`,
  composeToken: 'Wave',
  sevenTVId: emoteId,
  overlaying: true,
  added: true
};

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

function input(selector: string): HTMLInputElement {
  return requireValue(document.querySelector<HTMLInputElement>(selector), `Missing ${selector}`);
}

function previewDialog(): HTMLDialogElement {
  return requireValue(document.querySelector<HTMLDialogElement>('#preview'), 'Missing preview');
}

function click(selector: string): void {
  element(selector).click();
}

async function waitForText(selector: string, expected: string): Promise<void> {
  await vi.waitFor(() => {
    expect(element(selector).textContent).toContain(expected);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'false');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'false');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'false');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_SETTINGS', 'false');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  // jsdom does not implement modal dialog methods.
  const dialog = previewDialog();
  dialog.showModal = (): void => {
    dialog.open = true;
  };
  dialog.close = (): void => {
    dialog.open = false;
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.head.querySelector('link[rel="icon"]')?.remove();
});

test('browses and paginates the local catalog, previews an emote, and copies its name', async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    ...publicEmote,
    name: `Wave${index}`,
    overlaying: index === 49
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(items)));
  const writeText = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error('Clipboard unavailable'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

  try {
    await import('../src/main.ts');
    await waitForText('#message', 'Showing 48 of 50');
    expect(document.querySelector('header.masthead img[alt="Botge"]')).not.toBeNull();
    expect(document.querySelector('#composer[open]')).not.toBeNull();
    click('#more');
    expect(document.querySelectorAll('#results li')).toHaveLength(50);
    expect(element('#more').hidden).toBe(true);
    click('#select-emotes');
    for (const item of [...document.querySelectorAll<HTMLButtonElement>('#results button')].slice(
      0,
      13
    ))
      item.click();
    expect(element('#selection-status').textContent).toBe('Select up to 12 emotes at a time.');
    click('#results button');
    expect(element('#selection-status').textContent).toBe('11 of 12 selected');
    click('#select-emotes');

    const search = input('#search');
    search.value = 'No matching emote';
    search.dispatchEvent(new Event('input'));
    expect(element('#message').textContent).toBe('No emotes match your filters.');

    search.value = 'Wave49';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('#results li')).toHaveLength(1);

    input('#tag-search').value = ' greeting ';
    input('#tag-search').dispatchEvent(new Event('input'));
    const overlay = requireValue(
      document.querySelector<HTMLSelectElement>('#overlay-filter'),
      'Missing overlay filter'
    );
    overlay.value = 'overlaying';
    overlay.dispatchEvent(new Event('change'));
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    element('#results button').dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(previewDialog().open).toBe(false);
    expect(element('#emote-context-menu').hidden).toBe(false);
    click('#emote-context-menu button:first-child');
    expect(input('#composer-input').value).toBe('Wave49');
    expect(element('#emote-context-menu').hidden).toBe(true);
    click('#composer-clear');
    element('#results button').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    click('#emote-context-menu button:last-child');
    expect(element('#preview-tags').textContent).toContain('Greeting');
    expect(element('#preview-tags').textContent).toContain('Overlaying');
    expect(element('#preview-title').textContent).toBe('Wave49');
    expect(previewDialog().open).toBe(true);
    click('#copy');
    await waitForText('#copy-message', 'Copied.');
    expect(writeText).toHaveBeenCalledWith('Wave49');
    click('#copy');
    await waitForText('#copy-message', 'Name selected');

    click('#compose-add');
    expect(input('#composer-input').value).toBe('Wave49');
    expect(previewDialog().open).toBe(false);
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('uses the demo when the curated catalog is empty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])));
  await import('../src/main.ts');
  await waitForText('#results', 'Botge');
  expect(element('#results').textContent).toContain('Demo');
});

test('reports a failed curated catalog load', async () => {
  const error = vi.spyOn(console, 'error').mockReturnValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await import('../src/main.ts');
  await waitForText('#message', 'Could not load emotes');
  expect(error).toHaveBeenCalledOnce();
});

test('refreshes the server catalog, browses discovery, and adds an emote through Discord', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  sdk.commands.openExternalLink.mockRejectedValue(new Error('Link rejected'));

  let catalogCount = 0;
  let addCount = 0;
  let discoveryCount = 0;
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/catalog') {
      catalogCount += 1;
      if (catalogCount === 2) return Response.json({ message: 'Catalog unavailable.' });
      return Response.json({
        canManageEmotes: true,
        canComposeDiscovery: true,
        emotes: [
          serverEmote,
          {
            ...serverEmote,
            name: 'Other',
            added: false,
            composeToken: 'Other',
            sevenTVId: undefined
          }
        ]
      });
    }
    if (path === '/botge-api/emotes') {
      addCount += 1;
      return Response.json(addCount === 1 ? { message: 'Added emote.' } : {});
    }

    discoveryCount += 1;
    if (discoveryCount === 1) return new Response(null, { status: 503 });
    const items =
      discoveryCount === 2 ?
        [
          {
            id: discoveryId,
            defaultName: 'DiscoverWave',
            tags: ['Dance'],
            flags: { animated: true, nsfw: false, private: false, publicListed: true },
            images: [{ url: `https://cdn.7tv.app/emote/${discoveryId}/2x.webp` }]
          }
        ]
      : [];
    return Response.json({ data: { emotes: { search: { pageCount: 2, items } } } });
  });
  vi.stubGlobal('fetch', fetch);

  await import('../src/main.ts');
  await waitForText('#message', 'Showing 2 of 2');
  expect(element('#results li').textContent).toContain('Overlay');
  click('#results button');
  expect(element('#preview-source').textContent).toBe('7TV · Added');
  previewDialog().close();
  click('#added-filter');
  expect(document.querySelectorAll('#results li')).toHaveLength(1);
  click('#refresh-catalog');
  await waitForText('#message', 'Catalog unavailable.');

  click('#trending-mode');
  await waitForText('#message', 'Could not load 7TV emotes.');
  click('#more');
  await waitForText('#results', 'DiscoverWave');
  click('#results button');
  expect(element('#add').hidden).toBe(false);
  expect(element('#preview-tags').textContent).toContain('Dance');
  expect(element('#compose-add').hidden).toBe(false);
  click('#compose-add');
  expect(input('#composer-input').value).toBe(`7tv:${discoveryId}`);
  element('#results button').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 44, clientY: 52 })
  );
  expect(element('#emote-context-menu').textContent).toContain('Add to this server');
  const serverAction = [
    ...document.querySelectorAll<HTMLButtonElement>('#emote-context-menu button')
  ].find(
    (button: Readonly<Pick<HTMLButtonElement, 'textContent'>>) =>
      button.textContent === 'Add to this server'
  );
  requireValue(serverAction, 'Missing add to server action').click();
  await waitForText('#message', 'Added emote.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes',
    expect.objectContaining({
      body: JSON.stringify({ emoteId: discoveryId, code: 'oauth-code', guildId: sdk.guildId })
    }) as unknown
  );
  click('#results button');
  click('#add');
  await waitForText('#copy-message', 'Could not add this emote.');
  click('#open-7tv');
  await waitForText('#copy-message', 'Could not open 7TV.');

  click('#more');
  await vi.waitFor(() => {
    expect(element('#more').hidden).toBe(true);
  });
  click('#catalog-mode');
  await waitForText('#results', 'Wave');
  expect(element('#catalog-mode').getAttribute('aria-pressed')).toBe('true');
  expect(sdk.ready).toHaveBeenCalledOnce();
});

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
  const fetch = vi.fn((path: string, init: Readonly<{ body: string }>) => {
    if (path === '/botge-api/settings/border/read') {
      borderBodies.push(init.body);
      return borderBodies.length === 1 ?
          Response.json({ code: 'oauth_expired', message: 'Expired' }, { status: 401 })
        : Response.json({ color: 'FF7700' });
    }
    if (path === '/botge-api/settings') return Response.json({ voice, channels });
    if (path === '/botge-api/settings/voice')
      return Response.json({ voice: disconnected, channels });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);

  await import('../src/main.ts');
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
  expect(sdk.commands.authorize).toHaveBeenCalledTimes(3);

  channel.value = '';
  input('#voice-status-enabled').checked = false;
  click('#voice-settings button');
  await waitForText('#voice-feedback', 'Saved.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/settings/voice',
    expect.objectContaining({
      body: JSON.stringify({ voice: disconnected, code: 'oauth-code-4', guildId: sdk.guildId })
    }) as unknown
  );
  expect(input('#voice-status-emoji').value).toBe('<:Botge:123>');
  click('#catalog-link');
  expect(element('#catalog-page').hidden).toBe(false);
  expect(element('#activity-settings').hidden).toBe(true);
});

test('removes an individually added emote and refreshes the server catalog', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  let removed = false;
  const fetch = vi.fn((path: string) => {
    if (path.endsWith('/emotes/remove')) {
      removed = true;
      return Response.json({ message: 'Removed emote.', removed: true });
    }
    return Response.json({ canManageEmotes: true, emotes: removed ? [] : [serverEmote] });
  });
  vi.stubGlobal('fetch', fetch);
  await import('../src/main.ts');
  await waitForText('#message', 'Showing 1 of 1');
  click('#results button');
  expect(element('#remove').hidden).toBe(false);
  expect(element('#add').hidden).toBe(true);
  click('#remove');
  await waitForText('#copy-message', 'Removed emote.');
  await waitForText('#message', 'No emotes match');
  expect(element('#remove').hidden).toBe(true);
});

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
  await import('../src/main.ts');
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
      body: JSON.stringify({
        action: 'add',
        emoteIds: ids,
        code: 'oauth-code',
        guildId: sdk.guildId
      })
    }) as unknown
  );
  click('#selection-add');
  await waitForText('#selection-status', 'Added 1 of 1');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes/batch',
    expect.objectContaining({
      body: JSON.stringify({
        action: 'add',
        emoteIds: [nextId],
        code: 'oauth-code',
        guildId: sdk.guildId
      })
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
      body: JSON.stringify({
        action: 'remove',
        emoteIds: ids,
        code: 'oauth-code',
        guildId: sdk.guildId
      })
    }) as unknown
  );
  expect(updates).toBe(3);
  expect(document.querySelectorAll('#results li')).toHaveLength(1);
  click('#selection-clear');
  click('#select-emotes');
  expect(element('#selection').hidden).toBe(true);
});
