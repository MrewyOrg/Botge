// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { requireValue } from '../../src/validation.ts';
import {
  click,
  discoveryId,
  element,
  emoteId,
  input,
  previewDialog,
  publicEmote,
  sdk,
  serverEmote,
  waitForText
} from '../fixtures/activity-page.ts';

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
    await import('../../src/index.ts');
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

test('handles a full composer and unrelated context-menu targets', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([publicEmote])));
  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  for (let index = 0; index < 32; index += 1) {
    click('#results button');
    click('#compose-add');
  }
  click('#results button');
  expect(element('#copy-message').textContent).toContain('composer is full');
  expect(element('#compose-add').hasAttribute('disabled')).toBe(true);
  previewDialog().close();
  element('#results').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  const unrelated = document.createElement('button');
  unrelated.className = 'tile';
  element('#results').append(unrelated);
  unrelated.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(element('#emote-context-menu').hidden).toBe(true);
  element('#results li button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(element('#emote-context-menu').textContent).toBe('View details');
  click('#select-emotes');
  click('#results li button');
  click('#selection-compose');
  expect(element('#selection-status').textContent).toContain('composer is full');
});

test('discards superseded discovery responses and recovers from cancelled requests', async () => {
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  const first = Promise.withResolvers<Response>();
  const second = Promise.withResolvers<Response>();
  let requests = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string): Response | Promise<Response> => {
      if (path === './catalog.json') return Response.json([publicEmote]);
      requests += 1;
      return requests === 1 ? first.promise : second.promise;
    })
  );
  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  click('#trending-mode');
  await vi.waitFor(() => {
    expect(requests).toBe(1);
  });
  click('#top-mode');
  await vi.waitFor(() => {
    expect(requests).toBe(2);
  });
  first.resolve(Response.json({ data: { emotes: { search: { pageCount: 1, items: [] } } } }));
  await vi.waitFor(() => {
    expect(element('#more').hasAttribute('disabled')).toBe(true);
  });
  click('#catalog-mode');
  second.reject(new Error('Aborted'));
  await waitForText('#message', 'Showing 1 of 1');
  expect(element('#more').hasAttribute('disabled')).toBe(false);
});

test('keeps known composition tokens while hiding unavailable discovery actions', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'session', expiresIn: 3600 });
    if (path === '/botge-api/catalog')
      return Response.json({
        canManageEmotes: true,
        canComposeDiscovery: false,
        emotes: [{ ...serverEmote, added: false }, serverEmote]
      });
    return Response.json({
      data: {
        emotes: {
          search: {
            pageCount: 1,
            items: [emoteId, discoveryId].map((id) => ({
              id,
              defaultName: id === emoteId ? 'Known' : 'Unknown',
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
  await waitForText('#message', 'Showing 2 of 2');
  const source = requireValue(
    document.querySelector<HTMLSelectElement>('#source'),
    'Missing source'
  );
  source.value = '7TV';
  source.dispatchEvent(new Event('change'));
  click('#refresh-catalog');
  await vi.waitFor(() => {
    expect(
      fetch.mock.calls.filter(([path]: readonly [string]) => path === '/botge-api/catalog')
    ).toHaveLength(2);
  });
  expect(source.value).toBe('7TV');
  click('#trending-mode');
  click('#trending-mode');
  await waitForText('#message', 'Showing 2 7TV emotes');
  click('#results button');
  expect(element('#compose-add').hidden).toBe(false);
  click('#compose-add');
  expect(input('#composer-input').value).toBe('Wave');
  element('#results button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
  expect(element('#emote-context-menu').textContent).toContain('Remove from this server');
  click('#emote-context-menu button:last-child');
  previewDialog().close();
  click('#results li:last-child button');
  expect(element('#compose-add').hidden).toBe(true);
  expect(element('#add').hidden).toBe(true);
});
