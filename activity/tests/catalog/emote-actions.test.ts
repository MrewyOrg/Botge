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
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
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
    // A refused watch keeps the page from opening a live update connection.
    if (path === '/botge-api/catalog/watch') return Response.json({ message: 'Not watched.' });
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
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  let removed = false;
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    // A refused watch keeps the page from opening a live update connection.
    if (path === '/botge-api/catalog/watch') return Response.json({ message: 'Not watched.' });
    if (path.endsWith('/emotes/remove')) {
      removed = true;
      return Response.json({ message: 'Removed emote.', removed: true });
    }
    if (path.endsWith('/emotes')) {
      removed = false;
      return Response.json({ message: 'Added emote.', added: true });
    }
    return Response.json({ canManageEmotes: true, emotes: removed ? [] : [serverEmote] });
  });
  vi.stubGlobal('fetch', fetch);
  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  click('#results button');
  expect(element('#compose-add').hidden).toBe(false);
  expect(element('#remove').hidden).toBe(false);
  expect(element('#add').hidden).toBe(true);
  click('#remove');
  await waitForText('#copy-message', 'Removed emote.');
  await waitForText('#message', 'No emotes match');
  expect(element('#compose-add').hidden).toBe(true);
  expect(element('#remove').hidden).toBe(true);
  expect(element('#add').hidden).toBe(false);
  expect(element('#preview-source').textContent).toBe('7TV');
  click('#add');
  await waitForText('#copy-message', 'Added emote.');
  expect(element('#compose-add').hidden).toBe(false);
  expect(element('#remove').hidden).toBe(false);
  expect(element('#add').hidden).toBe(true);
  expect(element('#preview-source').textContent).toBe('7TV · Added');
});

test('keeps loaded discovery pages when an added emote refreshes the server catalog', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const otherId = '01234567890123456789012347' as const;
  const discovered = (id: string, name: string): Readonly<Record<string, unknown>> => ({
    id,
    defaultName: name,
    flags: { animated: false, nsfw: false, private: false, publicListed: true },
    images: [{ url: `https://cdn.7tv.app/emote/${id}/2x.webp` }]
  });
  let added = false;
  let discoveryCount = 0;
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    // A refused watch keeps the page from opening a live update connection.
    if (path === '/botge-api/catalog/watch') return Response.json({ message: 'Not watched.' });
    if (path === '/botge-api/emotes') {
      added = true;
      return Response.json({ message: 'Added emote.', added: true });
    }
    if (path === '/botge-api/catalog') {
      const saved = {
        ...serverEmote,
        name: 'First',
        composeToken: 'First',
        sevenTVId: discoveryId
      } as const;
      return Response.json({
        canManageEmotes: true,
        canComposeDiscovery: true,
        emotes: added ? [serverEmote, saved] : [serverEmote]
      });
    }
    discoveryCount += 1;
    const items =
      discoveryCount === 1 ? [discovered(discoveryId, 'First')] : [discovered(otherId, 'Second')];
    return Response.json({ data: { emotes: { search: { pageCount: 2, items } } } });
  });
  vi.stubGlobal('fetch', fetch);

  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  click('#trending-mode');
  await waitForText('#results', 'First');
  click('#more');
  await waitForText('#results', 'Second');
  const first = element('#results .tile');
  first.focus();
  first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  const serverAction = [
    ...document.querySelectorAll<HTMLButtonElement>('#emote-context-menu button')
  ].find(
    (button: Readonly<Pick<HTMLButtonElement, 'textContent'>>) =>
      button.textContent === 'Add to this server'
  );
  requireValue(serverAction, 'Missing add to server action').click();
  first.focus();
  await waitForText('#message', 'Added emote.');

  expect(discoveryCount).toBe(2);
  const names = [...document.querySelectorAll('#results .tile strong')].map(
    (name: Readonly<Pick<Element, 'textContent'>>) => name.textContent
  );
  expect(names).toEqual(['First', 'Second']);
  expect(element('#results .tile').textContent).toContain('Added');
  // The redrawn tile takes over keyboard focus from the replaced one.
  expect(document.activeElement).toBe(element('#results .tile'));
  click('#results .tile');
  expect(element('#add').hidden).toBe(true);
});

test('offers no server changes and sends none without the manage permission', async () => {
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_ADDS', 'true');
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  vi.stubEnv('VITE_ENABLE_7TV_DISCOVERY', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    // A refused watch keeps the page from opening a live update connection.
    if (path === '/botge-api/catalog/watch') return Response.json({ message: 'Not watched.' });
    if (path === '/botge-api/catalog')
      return Response.json({
        canManageEmotes: false,
        canComposeDiscovery: true,
        emotes: [serverEmote]
      });
    const items = [
      {
        id: discoveryId,
        defaultName: 'DiscoverWave',
        flags: { animated: false, nsfw: false, private: false, publicListed: true },
        images: [{ url: `https://cdn.7tv.app/emote/${discoveryId}/2x.webp` }]
      }
    ] as const;
    return Response.json({ data: { emotes: { search: { pageCount: 1, items } } } });
  });
  vi.stubGlobal('fetch', fetch);
  const serverActions = (): readonly string[] =>
    [...document.querySelectorAll('#emote-context-menu button')]
      .map((button: Readonly<Pick<Element, 'textContent'>>) => button.textContent)
      .filter((label: string | null) => label?.endsWith('this server') === true);

  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  // A saved emote cannot be removed.
  click('#results button');
  expect(element('#remove').hidden).toBe(true);
  previewDialog().close();
  element('#results .tile').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
  expect(element('#emote-context-menu').textContent).toContain('View details');
  expect(serverActions()).toEqual([]);

  // A discovered emote cannot be added, one at a time or in bulk.
  click('#trending-mode');
  await waitForText('#results', 'DiscoverWave');
  click('#results button');
  expect(element('#add').hidden).toBe(true);
  previewDialog().close();
  element('#results .tile').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
  expect(element('#emote-context-menu').textContent).toContain('View details');
  expect(serverActions()).toEqual([]);
  click('#select-emotes');
  click('#results button');
  expect(element('#selection-add').hidden).toBe(true);
  expect(element('#selection-remove').hidden).toBe(true);

  const changes = fetch.mock.calls.filter(([path]: readonly [string]) =>
    path.startsWith('/botge-api/emotes')
  );
  expect(changes).toEqual([]);
});

test('reloads the server catalog quietly when Botge reports a change', async () => {
  /** Lets the test play the server's side of the watch connection. */
  class FakeSocket extends EventTarget {
    public static readonly created: FakeSocket[] = [];
    public readonly sent: string[] = [];
    public constructor() {
      super();
      FakeSocket.created.push(this);
    }
    public send(data: string): void {
      this.sent.push(data);
    }
    public close(): void {
      this.dispatchEvent(new Event('close'));
    }
    public receive(type: string): void {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type }) }));
    }
  }
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', new URL('https://12345.discordsays.com/'));
  vi.stubEnv('VITE_ENABLE_ACTIVITY_CATALOG', 'true');
  sdk.ready.mockResolvedValue();
  sdk.commands.authorize.mockResolvedValue({ code: 'oauth-code' });

  let catalogCount = 0;
  const fetch = vi.fn((path: string) => {
    if (path === '/botge-api/auth')
      return Response.json({ accessToken: 'access-token', expiresIn: 3600 });
    if (path === '/botge-api/catalog/watch') return Response.json({ ticket: 'ticket-1' });
    catalogCount += 1;
    const emotes = Array.from({ length: catalogCount }, (_, index) => ({
      ...serverEmote,
      name: `Wave${String(index)}`,
      composeToken: `Wave${String(index)}`
    }));
    return Response.json({ canManageEmotes: false, emotes });
  });
  vi.stubGlobal('fetch', fetch);

  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 1 of 1');
  const socket = await vi.waitFor(() => requireValue(FakeSocket.created.at(0), 'No socket'));
  socket.dispatchEvent(new Event('open'));
  expect(socket.sent).toEqual([JSON.stringify({ type: 'watch', ticket: 'ticket-1' })]);
  socket.receive('watching');
  // Two changes in a row: the second arrives mid-load and runs once that load ends.
  socket.receive('changed');
  expect(element('#message').textContent).not.toContain('Loading');
  socket.receive('changed');
  await waitForText('#message', 'Showing 3 of 3');
  expect(catalogCount).toBe(3);
  expect(element('#refresh-catalog').hidden).toBe(true);
});
