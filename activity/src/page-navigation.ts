/* Owns catalog/settings navigation without exposing mutable page elements. */

import { requireValue } from './validation.ts';

/** Page navigation controls; enabling settings also honors the current URL fragment. */
type PageNavigation = { readonly enableSettings: () => void };

/**
 * Connects navigation links and URL changes to page visibility.
 *
 * @remarks
 * The tabs switch pages in place instead of jumping to their fragment, which would scroll the
 * catalog heading past the search and filters. Each switch records the fragment for history
 * navigation, scrolls to the top, and moves focus to the new page's top heading without scrolling,
 * so Tab continues from the start of that page. The first visit to Settings expands its panels, so
 * Tab reaches their fields instead of only the panel headers; expanding also starts their loads.
 *
 * @returns A control for revealing authenticated settings after Discord initialization.
 * @throws `Error` if required navigation markup is missing.
 */
export function createPageNavigation(): PageNavigation {
  const catalogLink = requireValue(
    document.querySelector<HTMLElement>('#catalog-link'),
    'Missing catalog link.'
  );
  const settingsLink = requireValue(
    document.querySelector<HTMLElement>('#settings-link'),
    'Missing settings link.'
  );
  const catalogPage = requireValue(
    document.querySelector<HTMLElement>('#catalog-page'),
    'Missing catalog page.'
  );
  const catalogIntro = requireValue(
    document.querySelector<HTMLElement>('#catalog-intro'),
    'Missing catalog heading.'
  );
  const composerPane = requireValue(
    document.querySelector<HTMLElement>('#composer-pane'),
    'Missing composer pane.'
  );
  const settingsPage = requireValue(
    document.querySelector<HTMLElement>('#activity-settings'),
    'Missing settings page.'
  );
  const catalogTitle = requireValue(
    document.querySelector<HTMLElement>('#catalog-title'),
    'Missing catalog title.'
  );
  const settingsHeading = requireValue(
    document.querySelector<HTMLElement>('#settings-heading'),
    'Missing settings heading.'
  );
  let settingsVisited = false;
  function showSettings(show: boolean): void {
    if (show && !settingsVisited) {
      settingsVisited = true;
      for (const panel of settingsPage.querySelectorAll('details')) panel.open = true;
    }
    settingsPage.hidden = !show;
    catalogIntro.hidden = show;
    catalogPage.hidden = show;
    composerPane.hidden = show;
    catalogLink.setAttribute('aria-current', show ? 'false' : 'page');
    settingsLink.setAttribute('aria-current', show ? 'page' : 'false');
  }

  function followUrl(): void {
    showSettings(settingsLink.hidden === false && window.location.hash === '#activity-settings');
  }

  function open(show: boolean): void {
    const hash = show ? '#activity-settings' : '#catalog-heading';
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    showSettings(show);
    document.documentElement.scrollTop = 0;
    (show ? settingsHeading : catalogTitle).focus({ preventScroll: true });
  }

  // Back and forward restore the page recorded for each fragment.
  window.addEventListener('hashchange', followUrl);
  window.addEventListener('popstate', followUrl);
  for (const [link, show] of [
    [catalogLink, false],
    [settingsLink, true]
  ] as const) {
    link.addEventListener('click', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
      event.preventDefault();
      open(show);
    });
  }
  return {
    enableSettings(): void {
      settingsLink.hidden = false;
      showSettings(window.location.hash === '#activity-settings');
    }
  };
}
