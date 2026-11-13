// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { requireValue } from '../../src/validation.ts';
import {
  click,
  discoveryId,
  element,
  input,
  previewDialog,
  sdk,
  serverEmote,
  waitForText
} from '../fixtures/activity-page.ts';

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
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
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

  await import('../../src/index.ts');
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
  click('#select-emotes');
  click('#results button');
  expect(element('#selection-add').hidden).toBe(false);
  expect(element('#selection-add').hasAttribute('disabled')).toBe(false);
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
  expect(element('#selection-add').hasAttribute('disabled')).toBe(true);
  await waitForText('#message', 'Added emote.');
  expect(element('#selection-add').hasAttribute('disabled')).toBe(false);
  click('#select-emotes');
  expect(fetch).toHaveBeenCalledWith(
    '/botge-api/emotes',
    expect.objectContaining({
      body: JSON.stringify({ emoteId: discoveryId, guildId: sdk.guildId })
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

test('removes an individually added emote and refreshes the server catalog', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  let removed = false;
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    if (path.endsWith('/emotes/remove')) {
      removed = true;
      return Response.json({ message: 'Removed emote.', removed: true });
    }
    return Response.json({ canManageEmotes: true, emotes: removed ? [] : [serverEmote] });
  });
  vi.stubGlobal('fetch', fetch);
  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  click('#results button');
  expect(element('#remove').hidden).toBe(false);
  expect(element('#add').hidden).toBe(true);
  click('#remove');
  await waitForText('#copy-message', 'Removed emote.');
  await waitForText('#message', 'No emotes match');
  expect(element('#remove').hidden).toBe(true);
});
