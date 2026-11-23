/* Filters and pages the catalog, and loads and redraws 7TV discovery pages in the results grid. */

import { type BrowserEmote, filterEmotes } from './catalog.ts';
import type { createEmoteAccess } from './emote-access.ts';
import { emoteKey } from './emote-selection.ts';
import type { DiscoveryMode, fetchDiscoveryPage } from './seventv.ts';
import { requireValue } from '../validation.ts';

/** One page of discovery results. */
export type DiscoveryPage = Awaited<ReturnType<typeof fetchDiscoveryPage>>;
type DiscoveryEmote = DiscoveryPage['emotes'][number];

/** The search and filter values a discovery request applies. */
type DiscoveryQuery = Readonly<{ query: string; motion: string; overlay: string; tags: string }>;

/** What the results grid shows: the guild catalog or a 7TV discovery mode. */
export type BrowseMode = 'catalog' | DiscoveryMode;

type ResultsOptions = {
  /** Builds the list item for one emote. */
  readonly tile: (emote: BrowserEmote, showComposerShortcut?: boolean) => HTMLLIElement;
  /** Loads one page of discovery results. */
  readonly discover: (
    mode: DiscoveryMode,
    page: number,
    query: DiscoveryQuery,
    signal: Readonly<AbortSignal>
  ) => Promise<DiscoveryPage>;
  /** Supplies saved emotes and the discovery compose permission. */
  readonly access: Pick<ReturnType<typeof createEmoteAccess>, 'known' | 'canComposeDiscovery'>;
  /** Whether discovery emotes may always be composed, as outside Discord. */
  readonly composeAnyDiscovery: boolean;
  /** Recounts active filters before each refresh. */
  readonly filters: Readonly<{ update: () => void }>;
  /** Shows a catalog status message. */
  readonly report: (feedback: string) => void;
  /** Runs after the catalog changes, so selection controls can follow. */
  readonly onCatalog: () => void;
};

const PAGE_SIZE = 48 as const;

/**
 * Creates the results grid controller.
 *
 * @remarks
 * The catalog filters locally and reveals 48 tiles per page. Discovery fetches 7TV pages; a newer
 * filter change aborts an older request, and search typing is debounced by the caller's delay.
 * After a catalog change, catalog mode keeps the loaded tile count and discovery redraws its
 * loaded pages in place instead of fetching page one again.
 *
 * @param options - Tile rendering, discovery loading, access state, and status reporting.
 * @returns Controls for the browse mode, refreshes, paging, and catalog replacement.
 * @throws `Error` if required results or filter markup is missing.
 */
export function createEmoteResults(options: ResultsOptions): {
  /** Returns the current browse mode. */
  readonly mode: () => BrowseMode;
  /**
   * Switches the browse mode and reloads the results.
   * @param mode - The mode to show.
   */
  readonly setMode: (mode: BrowseMode) => void;
  /**
   * Reloads the results from the first page after a search or filter change.
   * @param delay - Milliseconds to wait before a discovery request.
   */
  readonly update: (delay?: number) => void;
  /** Shows the next catalog page or loads the next discovery page. */
  readonly showMore: () => void;
  /**
   * Replaces the catalog and redraws without losing loaded pages.
   * @param entries - The new catalog; saved emotes must already be in the access state.
   */
  readonly setCatalog: (entries: readonly BrowserEmote[]) => void;
} {
  const { tile, access, report } = options;
  const input = (selector: string): HTMLInputElement =>
    requireValue(document.querySelector<HTMLInputElement>(selector), `Missing ${selector}.`);
  const select = (selector: string): HTMLSelectElement =>
    requireValue(document.querySelector<HTMLSelectElement>(selector), `Missing ${selector}.`);
  const search = input('#search');
  const tags = input('#tag-search');
  const motion = select('#motion');
  const overlay = select('#overlay-filter');
  const addedFilter = requireValue(
    document.querySelector('#added-filter'),
    'Missing added filter.'
  );
  const results = requireValue(document.querySelector('#results'), 'Missing results.');
  const heading = requireValue(
    document.querySelector<HTMLElement>('#catalog-heading'),
    'Missing catalog heading.'
  );
  const more = requireValue(
    document.querySelector<HTMLButtonElement>('#more'),
    'Missing pagination.'
  );

  let mode: BrowseMode = 'catalog';
  let catalog: readonly BrowserEmote[] = [];
  let matches: readonly BrowserEmote[] = [];
  let visible = 0;
  let page = 0;
  let request: AbortController | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  /** Undecorated 7TV entries in display order, kept to redraw tiles after catalog changes. */
  const loaded: DiscoveryEmote[] = [];
  const searchByMode: Record<BrowseMode, string> = { catalog: '', trending: '', top: '' };
  const snapshots = new WeakMap<Element, string>();

  /** Applies the guild's saved state and compose permission to a 7TV discovery entry. */
  function decorateDiscovery(emote: DiscoveryEmote): BrowserEmote {
    const id = emote.sevenTVId;
    const known = access.known(id);
    const token =
      known?.composeToken
      ?? (options.composeAnyDiscovery || access.canComposeDiscovery() ? `7tv:${id}` : undefined);
    return {
      ...emote,
      ...(known?.added === true ? { added: true } : {}),
      ...(known?.composeToken !== undefined ? { overlaying: known.overlaying === true } : {}),
      ...(token === undefined ? {} : { composeToken: token })
    };
  }

  function makeTile(emote: BrowserEmote, shortcut: boolean, snapshot: string): HTMLLIElement {
    const item = tile(emote, shortcut);
    item.dataset['emoteKey'] = emoteKey(emote);
    snapshots.set(item, snapshot);
    return item;
  }

  function appendTiles(emotes: readonly BrowserEmote[], shortcut: boolean): void {
    for (const emote of emotes)
      results.append(makeTile(emote, shortcut, JSON.stringify([shortcut, emote])));
  }

  function redraw(emotes: readonly BrowserEmote[], shortcut: boolean): void {
    const previous: readonly Element[] = [...results.children];
    const active = document.activeElement;
    const focusIndex = previous.findIndex((item: Readonly<Pick<Element, 'contains'>>) =>
      item.contains(active)
    );
    const focusKey =
      focusIndex < 0 ? undefined : previous[focusIndex]?.getAttribute('data-emote-key');
    const available = new Map<string, Element[]>();
    for (const item of previous) {
      const snapshot = snapshots.get(item);
      if (snapshot === undefined) continue;
      const siblings = available.get(snapshot) ?? [];
      siblings.push(item);
      available.set(snapshot, siblings);
    }
    const next: readonly Element[] = emotes.map((emote) => {
      const snapshot = JSON.stringify([shortcut, emote]);
      return available.get(snapshot)?.shift() ?? makeTile(emote, shortcut, snapshot);
    });
    const retained = new Set(next);
    for (const item of previous) if (!retained.has(item)) item.remove();
    for (const [index, item] of next.entries()) {
      const before = results.children.item(index);
      if (before === item) continue;
      if (item.parentElement === results && typeof results.moveBefore === 'function')
        results.moveBefore(item, before);
      else results.insertBefore(item, before);
    }
    if (focusIndex < 0 || document.activeElement === active) return;
    const sameEmote = next.find(
      (item: Readonly<Pick<Element, 'getAttribute'>>) =>
        item.getAttribute('data-emote-key') === focusKey
    );
    const sameControl = ['.tile-actions', '.tile-compose'] as const;
    const action = sameControl.find((selector) => active?.matches(selector) === true);
    const target =
      (action === undefined ? undefined : sameEmote?.querySelector<HTMLElement>(action))
      ?? (sameEmote ?? next[Math.min(focusIndex, next.length - 1)])?.querySelector<HTMLElement>(
        '.tile'
      )
      ?? heading;
    target.focus({ preventScroll: true });
  }

  function reportCatalogPage(): void {
    more.hidden = visible >= matches.length;
    report(
      matches.length === 0 ?
        'No emotes match your filters.'
      : `Showing ${visible} of ${matches.length}`
    );
  }

  function renderMore(count: number = PAGE_SIZE): void {
    const next: readonly BrowserEmote[] = matches.slice(visible, visible + count);
    appendTiles(next, true);
    visible += next.length;
    reportCatalogPage();
  }

  /** @param keep - Tiles to show at least, so a catalog refresh does not collapse loaded pages. */
  function resetCatalog(keep = 0): void {
    matches = filterEmotes(
      catalog,
      search.value,
      motion.value,
      addedFilter.getAttribute('aria-pressed') === 'true',
      overlay.value,
      tags.value
    );
    visible = Math.min(matches.length, Math.max(PAGE_SIZE, keep));
    redraw(matches.slice(0, visible), true);
    reportCatalogPage();
  }

  async function loadDiscovery(target: DiscoveryMode, next: number): Promise<void> {
    const current = new AbortController();
    // A filter change can replace a request while its results are in flight.
    request?.abort();
    request = current;
    more.disabled = true;
    report('Loading 7TV emotes…');
    try {
      const response = await options.discover(
        target,
        next,
        { query: search.value, motion: motion.value, overlay: overlay.value, tags: tags.value },
        current.signal
      );
      if (current.signal.aborted) return;
      loaded.push(...response.emotes);
      appendTiles(response.emotes.map(decorateDiscovery), false);
      page = next;
      more.hidden = next >= response.pageCount;
      more.textContent = 'Show more';
      const shown = results.childElementCount;
      report(shown === 0 ? 'No public emotes match these filters.' : `Showing ${shown} 7TV emotes`);
    } catch {
      if (current.signal.aborted) return;
      report('Could not load 7TV emotes.');
      more.textContent = 'Retry';
      more.hidden = false;
    } finally {
      if (request === current) {
        request = undefined;
        more.disabled = false;
      }
    }
  }

  function update(delay = 0): void {
    options.filters.update();
    clearTimeout(debounce);
    request?.abort();
    more.disabled = false;
    more.textContent = 'Show more';
    if (mode === 'catalog') {
      resetCatalog();
      return;
    }
    const discovery = mode;
    results.replaceChildren();
    loaded.length = 0;
    page = 0;
    more.hidden = true;
    report('Loading 7TV emotes…');
    debounce = setTimeout(() => {
      void loadDiscovery(discovery, 1);
    }, delay);
  }

  return {
    mode: () => mode,
    setMode(value): void {
      searchByMode[mode] = search.value;
      mode = value;
      search.value = searchByMode[mode];
      update();
    },
    update,
    showMore(): void {
      if (mode === 'catalog') renderMore();
      else void loadDiscovery(mode, page + 1);
    },
    setCatalog(entries): void {
      catalog = entries;
      options.onCatalog();
      if (mode === 'catalog') {
        resetCatalog(visible);
        return;
      }
      redraw(loaded.map(decorateDiscovery), false);
    }
  };
}
