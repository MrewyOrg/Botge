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
const publicEmote = { name: 'Wave', source: '7TV', image: 'emotes/wave.webp', animated: false };
const serverEmote = {
  ...publicEmote,
  image: `/7tv-cdn/emote/${emoteId}/2x.webp`,
  composeToken: 'Wave',
  sevenTVId: emoteId,
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
    name: `Wave${index}`
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
    click('#more');
    expect(document.querySelectorAll('#results li')).toHaveLength(50);
    expect(element('#more').hidden).toBe(true);

    const search = input('#search');
    search.value = 'No matching emote';
    search.dispatchEvent(new Event('input'));
    expect(element('#message').textContent).toBe('No emotes match your filters.');

    search.value = 'Wave49';
    search.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('#results li')).toHaveLength(1);

    click('#results button');
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
        emotes: [
          serverEmote,
          { ...serverEmote, name: 'Other', added: false, composeToken: 'Other' }
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
            id: emoteId,
            defaultName: 'DiscoverWave',
            flags: { animated: true, nsfw: false, private: false, publicListed: true },
            images: [{ url: `https://cdn.7tv.app/emote/${emoteId}/2x.webp` }]
          }
        ]
      : [];
    return Response.json({ data: { emotes: { search: { pageCount: 2, items } } } });
  });
  vi.stubGlobal('fetch', fetch);

  await import('../src/main.ts');
  await waitForText('#message', 'Showing 2 of 2');
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
  click('#add');
  await waitForText('#copy-message', 'Added emote.');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes',
    expect.objectContaining({
      body: JSON.stringify({ code: 'oauth-code', guildId: sdk.guildId, emoteId })
    }) as unknown
  );
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
