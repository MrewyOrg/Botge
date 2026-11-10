import { DiscordSDK } from '@discord/embedded-app-sdk';

import bannerUrl from '../../assets/banner.png';
import demoEmoteUrl from '../../assets/botge-emoji.png';
import iconUrl from '../../assets/botge-icon.png';
import { type BrowserEmote, filterEmotes, parseCatalog } from './catalog.ts';
import { createComposer } from './composer.ts';
import { type DiscoveryMode, fetchDiscoveryPage } from './seventv.ts';
import { isRecord, requireValue } from './validation.ts';
import './style.scss';

const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = iconUrl;
document.head.append(favicon);

const banner = new Image(680, 240);
banner.className = 'masthead-art';
banner.alt = 'Botge';
banner.src = bannerUrl;
requireValue(document.querySelector('#masthead-brand'), 'Missing masthead brand.').append(banner);

const search = requireValue(document.querySelector<HTMLInputElement>('#search'), 'Missing search.');
const source = requireValue(
  document.querySelector<HTMLSelectElement>('#source'),
  'Missing source.'
);
const motion = requireValue(
  document.querySelector<HTMLSelectElement>('#motion'),
  'Missing motion.'
);
const message = requireValue(document.querySelector('#message'), 'Missing status message.');
const results = requireValue(document.querySelector('#results'), 'Missing results.');
const more = requireValue(
  document.querySelector<HTMLButtonElement>('#more'),
  'Missing pagination.'
);
const preview = requireValue(
  document.querySelector<HTMLDialogElement>('#preview'),
  'Missing preview.'
);
const previewArt = requireValue(document.querySelector('#preview-art'), 'Missing preview art.');
const previewImage = document.createElement('img');
previewImage.alt = '';
const previewSource = requireValue(
  document.querySelector('#preview-source'),
  'Missing preview source.'
);
const previewTitle = requireValue(
  document.querySelector('#preview-title'),
  'Missing preview title.'
);
const previewName = requireValue(
  document.querySelector<HTMLInputElement>('#preview-name'),
  'Missing preview name.'
);
const copy = requireValue(
  document.querySelector<HTMLButtonElement>('#copy'),
  'Missing copy button.'
);
const copyMessage = requireValue(document.querySelector('#copy-message'), 'Missing copy status.');

const composer = createComposer();
const composeAdd = requireValue(
  document.querySelector<HTMLButtonElement>('#compose-add'),
  'Missing composer button.'
);

const add = requireValue(document.querySelector<HTMLButtonElement>('#add'), 'Missing add button.');
const openSevenTV = requireValue(
  document.querySelector<HTMLAnchorElement>('#open-7tv'),
  'Missing 7TV link.'
);
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
let catalogMatches: readonly BrowserEmote[] = [];
let visibleCount = 0;
let mode: 'catalog' | DiscoveryMode = 'catalog';
let currentPage = 0;
let discoveryRequest: AbortController | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let selected: BrowserEmote | undefined;
const pendingActions = new Set<'add' | 'catalog'>();
const appId = /^(?<appId>\d+)\.discordsays\.com$/u.exec(location.hostname)?.groups?.['appId'];
const discord =
  appId === undefined ? undefined : new DiscordSDK(appId, { disableConsoleLogOverride: true });
const allowAdds = import.meta.env['VITE_ENABLE_ACTIVITY_ADDS'] === 'true';
const serverGuildId =
  import.meta.env['VITE_ENABLE_ACTIVITY_CATALOG'] === 'true' ?
    (discord?.guildId ?? undefined)
  : undefined;
const refresh = requireValue(
  document.querySelector<HTMLButtonElement>('#refresh-catalog'),
  'Missing catalog refresh.'
);

async function requestServer(
  path: 'catalog' | 'emotes',
  guildId: string,
  emoteId?: string
): Promise<unknown> {
  if (discord === undefined || appId === undefined) throw new Error('Open Botge inside Discord.');
  const { code } = await discord.commands.authorize({
    client_id: appId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify']
  });
  const response = await fetch(`/botge-api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, guildId, emoteId }),
    signal: AbortSignal.timeout(35_000)
  });
  return (await response.json()) as unknown;
}

function showPreview(emote: BrowserEmote): void {
  selected = emote;
  composeAdd.hidden = emote.composeToken === undefined;
  composeAdd.disabled = composer.full();
  add.hidden =
    emote.sevenTVId === undefined
    || !allowAdds
    || discord === undefined
    || discord.guildId === null;
  add.disabled = pendingActions.has('add');
  openSevenTV.hidden = emote.sevenTVId === undefined;
  if (emote.sevenTVId !== undefined) openSevenTV.href = `https://7tv.app/emotes/${emote.sevenTVId}`;
  previewImage.src = emote.image;
  previewArt.append(previewImage);
  previewSource.textContent = emote.added === true ? `${emote.source} · Added` : emote.source;
  previewTitle.textContent = emote.name;
  previewName.value = emote.name;
  copyMessage.textContent =
    !composeAdd.hidden && composeAdd.disabled ?
      'The composer is full. Remove an input to add more.'
    : '';
  preview.showModal();
}

function makeTile(emote: BrowserEmote): HTMLLIElement {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  button.addEventListener('click', () => {
    showPreview(emote);
  });

  const image = document.createElement('img');
  image.src = emote.image;
  image.alt = '';
  image.width = 64;
  image.height = 64;
  image.loading = 'lazy';

  const name = document.createElement('strong');
  name.textContent = emote.name;
  const label = document.createElement('span');
  const tags = [emote.source];
  if (emote.added === true) tags.push('Added');
  if (emote.animated) tags.push('Animated');
  label.textContent = tags.join(' · ');
  button.append(image, name, label);
  item.append(button);
  return item;
}

function renderMore(): void {
  const page = catalogMatches.slice(visibleCount, visibleCount + PAGE_SIZE);
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
    addedFilter.getAttribute('aria-pressed') === 'true'
  );
  results.replaceChildren();
  visibleCount = 0;
  renderMore();
}

function updateCatalog(entries: readonly BrowserEmote[]): void {
  catalog = entries;
  const selectedSource = source.value;
  const sources = new Set(catalog.map((emote) => emote.source));
  source.length = 1;
  for (const name of sources) source.add(new Option(name, name));
  source.value = sources.has(selectedSource) ? selectedSource : '';
  if (mode === 'catalog') resetResults();
}

async function refreshServerCatalog(): Promise<void> {
  if (serverGuildId === undefined || pendingActions.has('catalog')) return;
  pendingActions.add('catalog');
  refresh.disabled = true;
  message.textContent = 'Loading server emotes…';
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
    updateCatalog(parseCatalog(payload['emotes'], true));
  } catch {
    if (mode === 'catalog')
      message.textContent = 'Could not load server emotes. Use Refresh to try again.';
  } finally {
    pendingActions.delete('catalog');
    refresh.disabled = false;
  }
}

async function copyName(): Promise<void> {
  try {
    await navigator.clipboard.writeText(previewName.value);
    copyMessage.textContent = 'Copied.';
  } catch {
    previewName.focus();
    previewName.select();
    copyMessage.textContent = 'Name selected. Use your device’s copy command.';
  }
}

async function loadDiscovery(nextPage: number): Promise<void> {
  if (mode === 'catalog') return;
  const request = new AbortController();
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
      request.signal
    );
    if (request.signal.aborted) return;
    results.append(...page.emotes.map(makeTile));
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

async function addSelectedEmote(): Promise<void> {
  const emote = selected;
  const guildId = discord?.guildId;
  if (
    !allowAdds
    || discord === undefined
    || appId === undefined
    || guildId === null
    || guildId === undefined
    || emote?.sevenTVId === undefined
    || pendingActions.has('add')
  )
    return;

  pendingActions.add('add');
  add.disabled = true;
  copyMessage.textContent = 'Adding emote…';
  try {
    const payload = await requestServer('emotes', guildId, emote.sevenTVId);
    if (!isRecord(payload) || typeof payload['message'] !== 'string')
      throw new Error('Invalid add response.');
    if (selected === emote) copyMessage.textContent = payload['message'];
  } catch {
    if (selected === emote)
      copyMessage.textContent = 'Could not add this emote. Try again or open it on 7TV.';
  } finally {
    pendingActions.delete('add');
    add.disabled = false;
  }
}

async function loadActivity(): Promise<void> {
  await discord?.ready();

  search.addEventListener('input', () => {
    updateFilters(300);
  });
  source.addEventListener('change', () => {
    updateFilters();
  });
  motion.addEventListener('change', () => {
    updateFilters();
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
  add.addEventListener('click', () => {
    void addSelectedEmote();
  });
  if (discord !== undefined) {
    openSevenTV.addEventListener('click', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
      event.preventDefault();
      void discord.commands.openExternalLink({ url: openSevenTV.href }).catch(() => {
        copyMessage.textContent = 'Could not open 7TV.';
      });
    });
  }
  composeAdd.addEventListener('click', () => {
    if (selected === undefined) return;
    composer.add(selected);
    preview.close();
  });
  copy.addEventListener('click', () => {
    void copyName();
  });
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
