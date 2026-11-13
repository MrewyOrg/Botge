/* Owns catalog/settings navigation without exposing mutable page elements. */

import { requireValue } from './validation.ts';

/** Page navigation controls; enabling settings also honors the current URL fragment. */
type PageNavigation = { readonly enableSettings: () => void };

/**
 * Connects navigation links and URL changes to page visibility.
 * @returns A control for revealing authenticated settings after Discord initialization.
 * @throws `Error` if required navigation markup is missing.
 */
export function createPageNavigation(): PageNavigation {
  const catalogLink = requireValue(
    document.querySelector('#catalog-link'),
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
  function showSettings(show: boolean): void {
    settingsPage.hidden = !show;
    catalogIntro.hidden = show;
    catalogPage.hidden = show;
    composerPane.hidden = show;
    catalogLink.setAttribute('aria-current', show ? 'false' : 'page');
    settingsLink.setAttribute('aria-current', show ? 'page' : 'false');
  }

  window.addEventListener('hashchange', () => {
    showSettings(settingsLink.hidden === false && window.location.hash === '#activity-settings');
  });
  catalogLink.addEventListener('click', () => {
    showSettings(false);
  });
  settingsLink.addEventListener('click', () => {
    showSettings(true);
  });
  return {
    enableSettings(): void {
      settingsLink.hidden = false;
      showSettings(window.location.hash === '#activity-settings');
    }
  };
}
