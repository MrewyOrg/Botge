// Copyright (c) 2026 MrewyOrg. Licensed under the MIT license.
// See LICENSE.txt in the project root for license information.

/**
 * Botge's Discord Activity for browsing emotes, composing previews, and editing settings.
 *
 * @remarks
 * This browser entry wires the page to the catalog, composer, and settings modules.
 * Discord-only features follow the build flags and the current guild context.
 * The package also includes the Cloudflare Worker that authenticates HTML requests.
 *
 * @see {@link https://github.com/MrewyOrg/Botge/wiki/Activity | Activity guide}
 * @packageDocumentation
 */

import { DiscordSDK } from '@discord/embedded-app-sdk';

import demoEmoteUrl from '../../assets/botge-emoji.png';
import iconUrl from '../../assets/botge-icon.png';
import { type ActivityOperation, createActivityApi, waitForDiscord } from './activity-api.ts';
import { type BrowserEmote, filterEmotes, parseCatalog } from './catalog/catalog.ts';
import { createComposer } from './composer/composer.ts';
import { createContextMenu } from './context-menu.ts';
import { createEmotePreview } from './catalog/emote-preview.ts';
import { createEmoteSelection, emoteKey } from './catalog/emote-selection.ts';
import { createPageNavigation } from './page-navigation.ts';
import { mountEmoteBorderSettings } from './settings/emote-border-settings.ts';
import { mountEmoteSettings } from './settings/emote-settings.ts';
import { type DiscoveryMode, fetchDiscoveryPage } from './catalog/seventv.ts';
import { isRecord, requireValue } from './validation.ts';
import { mountVoiceSettings } from './settings/voice-settings.ts';
import './style.scss';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = iconUrl;
document.head.append(favicon);

const search = requireValue(document.querySelector<HTMLInputElement>('#search'), 'Missing search.');
const source = requireValue(
  document.querySelector<HTMLSelectElement>('#source'),
  'Missing source.'
);
const motion = requireValue(
  document.querySelector<HTMLSelectElement>('#motion'),
  'Missing motion.'
);
const overlay = requireValue(
  document.querySelector<HTMLSelectElement>('#overlay-filter'),
  'Missing layering filter.'
);
const tags = requireValue(
  document.querySelector<HTMLInputElement>('#tag-search'),
  'Missing tag search.'
);
const message = requireValue(document.querySelector('#message'), 'Missing status message.');
const results = requireValue(
  document.querySelector<HTMLUListElement>('#results'),
  'Missing results.'
);
const more = requireValue(
  document.querySelector<HTMLButtonElement>('#more'),
  'Missing pagination.'
);
const composer = createComposer();
const contextMenu = createContextMenu();
const tileEmotes = new WeakMap<HTMLButtonElement, BrowserEmote>();
const modes = requireValue(
  document.querySelector<HTMLElement>('#browse-modes'),
  'Missing browse modes.'
);
const addedFilter = requireValue(
  document.querySelector<HTMLButtonElement>('#added-filter'),
  'Missing added emotes filter.'
);
const sourceFilter = requireValue(
  document.querySelector<HTMLElement>('#source-filter'),
  'Missing source filter.'
);

const PAGE_SIZE = 48;
let catalog: readonly BrowserEmote[] = [];
let canManageEmotes = false;
let canComposeDiscovery = false;
let knownSevenTV = new Map<string, BrowserEmote>();
let catalogMatches: readonly BrowserEmote[] = [];
let visibleCount = 0;
let mode: 'catalog' | DiscoveryMode = 'catalog';
let currentPage = 0;
let discoveryRequest: AbortController | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
const pendingActions = new Set<'add' | 'catalog'>();
const appId = /^(?<appId>\d+)\.discordsays\.com$/u.exec(location.hostname)?.groups?.['appId'];
const discord =
  appId === undefined ? undefined : new DiscordSDK(appId, { disableConsoleLogOverride: true });
const activityApi =
  discord === undefined || appId === undefined ?
    undefined
  : createActivityApi({
      authorize: async () =>
        await discord.commands.authorize({
          client_id: appId,
          response_type: 'code',
          state: '',
          prompt: 'none',
          scope: ['identify']
        }),
      authenticate: async (token) => await discord.commands.authenticate({ access_token: token })
    });
const allowAdds = import.meta.env['VITE_ENABLE_ACTIVITY_ADDS'] === 'true';
const serverGuildId =
  import.meta.env['VITE_ENABLE_ACTIVITY_CATALOG'] === 'true' ?
    (discord?.guildId ?? undefined)
  : undefined;
const refresh = requireValue(
  document.querySelector<HTMLButtonElement>('#refresh-catalog'),
  'Missing catalog refresh.'
);

async function requestServer(...operation: ActivityOperation): Promise<unknown> {
  if (activityApi === undefined) throw new Error('Open Botge inside Discord.');
  return await activityApi(...operation);
}

function canChangeEmote(emote: BrowserEmote, removing: boolean): boolean {
  if (!canManageEmotes || emote.sevenTVId === undefined) return false;
  const known = knownSevenTV.get(emote.sevenTVId);
  return removing ? known?.added === true : allowAdds && known === undefined;
}

const navigation = createPageNavigation();
const selection = createEmoteSelection({
  composer,
  canChange: canChangeEmote,
  isBusy: () => pendingActions.has('add')
});
const preview = createEmotePreview({
  composer,
  canChange: canChangeEmote,
  isBusy: () => pendingActions.has('add'),
  onCompose(): void {
    selection.refresh();
  },
  openExternal:
    discord === undefined ? undefined : (
      async (url): Promise<unknown> => await discord.commands.openExternalLink({ url })
    )
});

function makeTile(emote: BrowserEmote): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  const key = emoteKey(emote);
  button.dataset['key'] = key;
  if (selection.active) button.setAttribute('aria-pressed', String(selection.has(key)));
  button.addEventListener('click', () => {
    if (selection.active) selection.toggle(emote);
    else preview.show(emote);
  });
  tileEmotes.set(button, emote);

  const image = document.createElement('img');
  image.src = emote.image;
  image.alt = '';
  image.width = 64;
  image.height = 64;
  image.loading = 'lazy';

  const art = document.createElement('span');
  art.className = 'tile-art';
  art.append(image);

  const details = document.createElement('span');
  details.className = 'tile-details';
  const name = document.createElement('strong');
  name.textContent = emote.name;
  const label = document.createElement('span');
  const labels = [emote.source];
  if (emote.added === true) labels.push('Added');
  if (emote.animated) labels.push('Animated');
  if (emote.overlaying === true) labels.push('Overlaying');
  label.textContent = labels.join(' · ');
  details.append(name, label);
  button.append(art, details);
  item.append(button);
  return item;
}

function renderMore(): void {
  const page: readonly BrowserEmote[] = catalogMatches.slice(
    visibleCount,
    visibleCount + PAGE_SIZE
  );
  results.append(...page.map(makeTile));
  visibleCount += page.length;
  more.hidden = visibleCount >= catalogMatches.length;
  message.textContent =
    catalogMatches.length === 0 ?
      'No emotes match your filters.'
    : `Showing ${visibleCount} of ${catalogMatches.length}`;
}

function resetResults(): void {
  catalogMatches = filterEmotes(
    catalog,
    search.value,
    source.value,
    motion.value,
    addedFilter.getAttribute('aria-pressed') === 'true',
    overlay.value,
    tags.value
  );
  results.replaceChildren();
  visibleCount = 0;
  renderMore();
}

function updateCatalog(entries: readonly BrowserEmote[]): void {
  catalog = entries;
  knownSevenTV = new Map();
  // If an ID occurs in both a feed and the added list, keep the entry the guild can remove.
  for (const emote of entries) {
    if (
      emote.sevenTVId !== undefined
      && (!knownSevenTV.has(emote.sevenTVId) || emote.added === true)
    )
      knownSevenTV.set(emote.sevenTVId, emote);
  }
  selection.refresh();
  const selectedSource = source.value;
  const sources = new Set(catalog.map((emote) => emote.source));
  source.length = 1;
  for (const name of sources) source.add(new Option(name, name));
  source.value = sources.has(selectedSource) ? selectedSource : '';
  if (mode === 'catalog') resetResults();
}

async function loadDiscovery(nextPage: number): Promise<void> {
  if (mode === 'catalog') return;
  const request = new AbortController();
  // A filter change can replace a request while its results are in flight.
  discoveryRequest?.abort();
  discoveryRequest = request;
  more.disabled = true;
  message.textContent = 'Loading 7TV emotes…';
  try {
    const page = await fetchDiscoveryPage(
      mode,
      nextPage,
      search.value,
      motion.value,
      discord !== undefined,
      request.signal,
      overlay.value,
      tags.value
    );
    if (request.signal.aborted) return;
    results.append(
      ...page.emotes.map((emote) => {
        const id = emote.sevenTVId;
        const known = knownSevenTV.get(id);
        const token =
          known?.composeToken
          ?? (discord === undefined || canComposeDiscovery ? `7tv:${id}` : undefined);
        return makeTile({
          ...emote,
          ...(known?.added === true ? { added: true } : {}),
          ...(known?.composeToken !== undefined ? { overlaying: known.overlaying === true } : {}),
          ...(token === undefined ? {} : { composeToken: token })
        });
      })
    );
    currentPage = nextPage;
    more.hidden = nextPage >= page.pageCount;
    more.textContent = 'Show more';
    const shown = results.childElementCount;
    message.textContent =
      shown === 0 ? 'No public emotes match these filters.' : `Showing ${shown} 7TV emotes`;
  } catch {
    if (request.signal.aborted) return;
    message.textContent = 'Could not load 7TV emotes.';
    more.textContent = 'Retry';
    more.hidden = false;
  } finally {
    if (discoveryRequest === request) {
      discoveryRequest = undefined;
      more.disabled = false;
    }
  }
}

function updateFilters(delay = 0): void {
  clearTimeout(debounce);
  discoveryRequest?.abort();
  more.disabled = false;
  more.textContent = 'Show more';
  if (mode === 'catalog') {
    resetResults();
    return;
  }
  results.replaceChildren();
  currentPage = 0;
  more.hidden = true;
  message.textContent = 'Loading 7TV emotes…';
  debounce = setTimeout(() => {
    void loadDiscovery(1);
  }, delay);
}

async function refreshServerCatalog(): Promise<void> {
  if (serverGuildId === undefined || pendingActions.has('catalog')) return;
  pendingActions.add('catalog');
  refresh.disabled = true;
  if (mode === 'catalog') message.textContent = 'Loading server emotes…';
  try {
    const payload = await requestServer('catalog', serverGuildId);
    if (!isRecord(payload) || !Array.isArray(payload['emotes'])) {
      if (mode === 'catalog')
        message.textContent =
          isRecord(payload) && typeof payload['message'] === 'string' ?
            payload['message']
          : 'Could not load server emotes.';
      return;
    }
    const entries = parseCatalog(payload['emotes'], true);
    canManageEmotes = payload['canManageEmotes'] === true;
    canComposeDiscovery = payload['canComposeDiscovery'] === true;
    updateCatalog(entries);
    if (mode !== 'catalog') updateFilters();
  } catch {
    if (mode === 'catalog')
      message.textContent = 'Could not load server emotes. Use Refresh to try again.';
  } finally {
    pendingActions.delete('catalog');
    refresh.disabled = false;
  }
}

async function changeEmote(
  emote: BrowserEmote | undefined,
  removing: boolean,
  report: (feedback: string) => void
): Promise<void> {
  const guildId = discord?.guildId;
  if (
    guildId === null
    || guildId === undefined
    || emote?.sevenTVId === undefined
    || pendingActions.has('add')
    || !canChangeEmote(emote, removing)
  )
    return;

  pendingActions.add('add');
  selection.refresh();
  preview.setBusy(true);
  report(removing ? 'Removing emote…' : 'Adding emote…');
  try {
    const payload = await requestServer(removing ? 'emotes/remove' : 'emotes', guildId, {
      emoteId: emote.sevenTVId
    });
    if (!isRecord(payload) || typeof payload['message'] !== 'string')
      throw new Error('Invalid add response.');
    if (payload['removed'] === true || payload['added'] === true) {
      await refreshServerCatalog();
      preview.refreshActions(emote);
    }
    report(payload['message']);
  } catch {
    report(
      removing ?
        'Could not remove this emote. Try again.'
      : 'Could not add this emote. Try again or open it on 7TV.'
    );
  } finally {
    pendingActions.delete('add');
    selection.refresh();
    preview.setBusy(false);
  }
}

results.addEventListener(
  'contextmenu',
  (
    event: Readonly<{
      target: unknown;
      clientX: number;
      clientY: number;
      preventDefault: () => void;
    }>
  ) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.tile') : null;
    const emote = button === null ? undefined : tileEmotes.get(button);
    if (button === null || emote === undefined) return;
    event.preventDefault();
    const actions: { label: string; run: () => void }[] = [];
    if (emote.composeToken !== undefined && !composer.full())
      actions.push({
        label: 'Add to composer',
        run() {
          composer.add(emote);
          selection.refresh();
        }
      });
    for (const removing of [false, true]) {
      if (!canChangeEmote(emote, removing) || pendingActions.has('add')) continue;
      actions.push({
        label: removing ? 'Remove from this server' : 'Add to this server',
        run() {
          void changeEmote(emote, removing, (feedback) => {
            message.textContent = feedback;
          });
        }
      });
    }
    actions.push({
      label: 'View details',
      run() {
        preview.show(emote);
      }
    });
    contextMenu.open(button, event.clientX, event.clientY, actions);
  }
);

async function changeSelection(removing: boolean): Promise<void> {
  const guildId = discord?.guildId;
  if (guildId === undefined || guildId === null || pendingActions.has('add')) return;
  const ids: readonly string[] = [
    ...new Set(
      selection
        .entries()
        .flatMap((emote) =>
          emote.sevenTVId !== undefined && canChangeEmote(emote, removing) ? [emote.sevenTVId] : []
        )
    )
  ];
  if (ids.length === 0) return;
  pendingActions.add('add');
  let feedback = '';
  selection.refresh(removing ? 'Removing selected emotes…' : 'Adding selected emotes…');
  try {
    const payload = await requestServer('emotes/batch', guildId, {
      action: removing ? 'remove' : 'add',
      emoteIds: ids
    });
    if (isRecord(payload) && typeof payload['message'] === 'string')
      throw new Error(payload['message']);
    if (!Array.isArray(payload)) throw new Error('Invalid bulk emote response.');
    const succeeded = new Set<string>();
    let failure = '';
    const changes: readonly unknown[] = payload;
    for (const result of changes) {
      if (
        !isRecord(result)
        || typeof result['emoteId'] !== 'string'
        || !ids.includes(result['emoteId'])
      )
        continue;
      if (result['ok'] === true) succeeded.add(result['emoteId']);
      else if (failure === '' && typeof result['message'] === 'string') failure = result['message'];
    }
    // Keep failed items selected so the user can retry them without picking them again.
    selection.removeSucceeded([...succeeded]);
    if (succeeded.size > 0) await refreshServerCatalog();
    feedback =
      `${removing ? 'Removed' : 'Added'} ${succeeded.size} of ${ids.length}. ${failure}`.trim();
  } catch (error) {
    feedback = error instanceof Error ? error.message : 'Could not update selected emotes.';
  } finally {
    pendingActions.delete('add');
    selection.refresh(feedback);
  }
}

async function loadActivity(): Promise<void> {
  if (discord !== undefined)
    await waitForDiscord(async () => {
      await discord.ready();
    });
  const settingsGuildId = discord?.guildId ?? undefined;
  if (
    import.meta.env['VITE_ENABLE_ACTIVITY_SETTINGS'] === 'true'
    && settingsGuildId !== undefined
  ) {
    navigation.enableSettings();
    mountEmoteBorderSettings(async (color) => {
      if (color === undefined) return await requestServer('settings/border/read', settingsGuildId);
      return await requestServer('settings/border', settingsGuildId, { color });
    });
    mountVoiceSettings(async (voice) => {
      if (voice === undefined) return await requestServer('settings', settingsGuildId);
      return await requestServer('settings/voice', settingsGuildId, { voice });
    });
    mountEmoteSettings(async (emotes) => {
      if (emotes === undefined) return await requestServer('settings/emotes/read', settingsGuildId);
      return await requestServer('settings/emotes', settingsGuildId, { emotes });
    });
  }

  preview.connectChanges(changeEmote);
  selection.connectChanges((removing) => {
    void changeSelection(removing);
  });

  search.addEventListener('input', () => {
    updateFilters(300);
  });
  source.addEventListener('change', () => {
    updateFilters();
  });
  motion.addEventListener('change', () => {
    updateFilters();
  });
  overlay.addEventListener('change', () => {
    updateFilters();
  });
  tags.addEventListener('input', () => {
    updateFilters(300);
  });
  more.addEventListener('click', () => {
    if (mode === 'catalog') renderMore();
    else void loadDiscovery(currentPage + 1);
  });
  if (import.meta.env['VITE_ENABLE_7TV_DISCOVERY'] === 'true') {
    const buttons = [
      ['catalog', requireValue(document.querySelector('#catalog-mode'), 'Missing catalog mode.')],
      [
        'trending',
        requireValue(document.querySelector('#trending-mode'), 'Missing trending mode.')
      ],
      ['top', requireValue(document.querySelector('#top-mode'), 'Missing top mode.')]
    ] as const;
    function selectMode(value: 'catalog' | DiscoveryMode): void {
      if (mode !== value) selection.clear();
      mode = value;
      sourceFilter.hidden = value !== 'catalog';
      addedFilter.hidden = value !== 'catalog' || serverGuildId === undefined;
      refresh.hidden = value !== 'catalog' || serverGuildId === undefined;
      for (const [key, tab] of buttons) tab.setAttribute('aria-pressed', String(key === value));
      updateFilters();
      if (value === 'catalog' && serverGuildId !== undefined) void refreshServerCatalog();
    }
    for (const [value, button] of buttons) {
      button.addEventListener('click', () => {
        selectMode(value);
      });
    }
    modes.hidden = false;
  }
  if (serverGuildId !== undefined) {
    refresh.hidden = false;
    addedFilter.hidden = false;
    addedFilter.addEventListener('click', () => {
      const active = addedFilter.getAttribute('aria-pressed') === 'true';
      addedFilter.setAttribute('aria-pressed', String(!active));
      updateFilters();
    });
    refresh.addEventListener('click', () => {
      void refreshServerCatalog();
    });
    await refreshServerCatalog();
  } else {
    const response = await fetch('./catalog.json', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Could not fetch the emote catalog.');
    const loaded = parseCatalog((await response.json()) as unknown);
    updateCatalog(
      loaded.length === 0 ?
        [
          {
            name: 'Botge',
            source: 'Demo',
            image: demoEmoteUrl,
            animated: false,
            composeToken: 'Botge'
          }
        ]
      : loaded
    );
  }
}

void loadActivity().catch((error: unknown) => {
  if (mode === 'catalog')
    message.textContent = 'Could not load emotes. Reopen the Activity to try again.';
  console.error(error);
});
