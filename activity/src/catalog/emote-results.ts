/* Filters and pages the catalog, and loads and redraws 7TV discovery pages in the results grid. */

import { type BrowserEmote, filterEmotes } from './catalog.ts';
import type { createEmoteAccess } from './emote-access.ts';
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
  readonly tile: (emote: BrowserEmote) => HTMLLIElement;
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
  const source = select('#source');
  const motion = select('#motion');
  const overlay = select('#overlay-filter');
  const addedFilter = requireValue(
    document.querySelector('#added-filter'),
    'Missing added filter.'
  );
  const results = requireValue(document.querySelector('#results'), 'Missing results.');
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

  /** Applies the guild's saved state and compose permission to a 7TV discovery entry. */
  function discoveryTile(emote: DiscoveryEmote): HTMLLIElement {
    const id = emote.sevenTVId;
    const known = access.known(id);
    const token =
      known?.composeToken
      ?? (options.composeAnyDiscovery || access.canComposeDiscovery() ? `7tv:${id}` : undefined);
    return tile({
      ...emote,
      ...(known?.added === true ? { added: true } : {}),
      ...(known?.composeToken !== undefined ? { overlaying: known.overlaying === true } : {}),
      ...(token === undefined ? {} : { composeToken: token })
    });
  }

  function renderMore(count: number = PAGE_SIZE): void {
    const next: readonly BrowserEmote[] = matches.slice(visible, visible + count);
    results.append(...next.map(tile));
    visible += next.length;
    more.hidden = visible >= matches.length;
    report(
      matches.length === 0 ?
        'No emotes match your filters.'
      : `Showing ${visible} of ${matches.length}`
    );
  }

  /** @param keep - Tiles to show at least, so a catalog refresh does not collapse loaded pages. */
  function resetCatalog(keep = 0): void {
    matches = filterEmotes(
      catalog,
      search.value,
      source.value,
      motion.value,
      addedFilter.getAttribute('aria-pressed') === 'true',
      overlay.value,
      tags.value
    );
    results.replaceChildren();
    visible = 0;
    renderMore(Math.max(PAGE_SIZE, keep));
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
      results.append(...response.emotes.map(discoveryTile));
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
      mode = value;
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
      const selected = source.value;
      const sources = new Set(catalog.map((emote) => emote.source));
      source.length = 1;
      for (const name of sources) source.add(new Option(name, name));
      source.value = sources.has(selected) ? selected : '';
      if (mode === 'catalog') {
        resetCatalog(visible);
        return;
      }
      // Keep loaded pages and keyboard focus instead of fetching page one again.
      const focused = [...results.children].findIndex((item: Readonly<Pick<Element, 'contains'>>) =>
        item.contains(document.activeElement)
      );
      results.replaceChildren(...loaded.map(discoveryTile));
      results.children.item(focused)?.querySelector<HTMLButtonElement>('.tile')?.focus();
    }
  };
}
