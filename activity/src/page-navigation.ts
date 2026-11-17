/* Owns catalog/settings/game navigation without exposing mutable page elements. */

import { requireValue } from './validation.ts';

/** Page navigation controls; enabling a page also honors the current URL fragment. */
type PageNavigation = {
  readonly enableSettings: () => void;
  /** Reveals the game tab. `onOpen` runs every time the game page is shown. */
  readonly enableGame: (onOpen: () => void) => void;
  /**
   * Closes or reopens the catalog. While closed, its tab is disabled, its fragment leads to the
   * game page, and a visitor already on the catalog is moved to the game page.
   */
  readonly lockCatalog: (locked: boolean) => void;
};

type Page = 'catalog' | 'settings' | 'game';

const HASHES = {
  catalog: '#catalog-heading',
  settings: '#activity-settings',
  game: '#activity-game'
} as const satisfies Record<Page, string>;

function element(selector: string, description: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${description}.`);
}

/**
 * Connects navigation links and URL changes to page visibility.
 *
 * @remarks
 * The tabs switch pages in place instead of jumping to their fragment, which would scroll the
 * catalog heading past the search and filters. Each switch records the fragment for history
 * navigation, starts at the top unless the game page positions itself, and moves focus to the new page's top heading without scrolling,
 * so Tab continues from the start of that page. The first visit to Settings expands its panels, so
 * Tab reaches their fields instead of only the panel headers; expanding also starts their loads.
 * A fragment for a page that is not enabled shows the catalog. During a guessing game match the
 * catalog is locked, because it lists the names players are trying to guess.
 *
 * @returns Controls for revealing the authenticated pages after Discord initialization.
 * @throws `Error` if required navigation markup is missing.
 */
export function createPageNavigation(): PageNavigation {
  const links = {
    catalog: element('#catalog-link', 'catalog link'),
    settings: element('#settings-link', 'settings link'),
    game: element('#game-link', 'game link')
  } as const satisfies Record<Page, HTMLElement>;
  const headings = {
    catalog: element('#catalog-title', 'catalog title'),
    settings: element('#settings-heading', 'settings heading'),
    game: element('#game-heading', 'game heading')
  } as const satisfies Record<Page, HTMLElement>;
  const catalogPage = element('#catalog-page', 'catalog page');
  const catalogIntro = element('#catalog-intro', 'catalog heading');
  const composerPane = element('#composer-pane', 'composer pane');
  const settingsPage = element('#activity-settings', 'settings page');
  const gamePage = element('#activity-game', 'game page');
  const pages = ['catalog', 'settings', 'game'] as const satisfies readonly Page[];
  let settingsVisited = false;
  let openGame: (() => void) | undefined;
  let catalogLocked = false;
  let shown: Page = 'catalog';

  function show(requested: Page): void {
    const page = catalogLocked && requested === 'catalog' ? 'game' : requested;
    // A locked catalog fragment is replaced so the address matches the page on screen.
    if (page !== requested) window.history.replaceState(null, '', HASHES[page]);
    shown = page;
    if (page === 'settings' && !settingsVisited) {
      settingsVisited = true;
      for (const panel of settingsPage.querySelectorAll('details')) panel.open = true;
    }
    settingsPage.hidden = page !== 'settings';
    gamePage.hidden = page !== 'game';
    catalogIntro.hidden = page !== 'catalog';
    catalogPage.hidden = page !== 'catalog';
    composerPane.hidden = page !== 'catalog';
    for (const key of pages)
      links[key].setAttribute('aria-current', key === page ? 'page' : 'false');
    if (page === 'game') openGame?.();
  }

  function followUrl(): void {
    const page = pages.find(
      (key) =>
        key !== 'catalog' && links[key].hidden === false && window.location.hash === HASHES[key]
    );
    show(page ?? 'catalog');
  }

  function open(page: Page): void {
    if (catalogLocked && page === 'catalog') return;
    const hash = HASHES[page];
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    // Reset the scroll before the switch, so a page that positions itself on open keeps its place.
    document.documentElement.scrollTop = 0;
    show(page);
    headings[page].focus({ preventScroll: true });
  }

  // Back and forward restore the page recorded for each fragment.
  window.addEventListener('hashchange', followUrl);
  window.addEventListener('popstate', followUrl);
  for (const page of pages) {
    links[page].addEventListener('click', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
      event.preventDefault();
      open(page);
    });
  }
  return {
    enableSettings(): void {
      links.settings.hidden = false;
      followUrl();
    },
    enableGame(onOpen): void {
      openGame = onOpen;
      links.game.hidden = false;
      followUrl();
    },
    lockCatalog(locked): void {
      catalogLocked = locked;
      links.catalog.setAttribute('aria-disabled', String(locked));
      // Showing the catalog while it is locked redirects to the game and fixes the address.
      if (locked && shown === 'catalog') show('catalog');
    }
  };
}
