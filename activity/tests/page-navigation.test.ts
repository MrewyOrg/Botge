// @vitest-environment jsdom

import { beforeEach, expect, test } from 'vitest';

import html from '../index.html?raw';
import { createPageNavigation } from '../src/page-navigation.ts';
import { requireValue } from '../src/validation.ts';

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

function panels(): readonly HTMLDetailsElement[] {
  return [...document.querySelectorAll<HTMLDetailsElement>('#activity-settings details')];
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  window.history.replaceState(null, '', '/');
});

test('switches pages in place and focuses the top heading of each page', () => {
  createPageNavigation().enableSettings();
  expect(panels().some((panel: Readonly<Pick<HTMLDetailsElement, 'open'>>) => panel.open)).toBe(
    false
  );

  element('#settings-link').click();
  expect(window.location.hash).toBe('#activity-settings');
  expect(element('#activity-settings').hidden).toBe(false);
  expect(document.activeElement).toBe(element('#settings-heading'));
  // The first visit expands every panel so Tab reaches their fields.
  expect(panels().every((panel: Readonly<Pick<HTMLDetailsElement, 'open'>>) => panel.open)).toBe(
    true
  );
  const [first] = panels();
  requireValue(first, 'Missing panel').open = false;

  element('#catalog-link').click();
  expect(window.location.hash).toBe('#catalog-heading');
  expect(element('#catalog-page').hidden).toBe(false);
  expect(document.activeElement).toBe(element('#catalog-title'));

  // Later visits keep panels the user collapsed.
  element('#settings-link').click();
  expect(first?.open).toBe(false);
  element('#settings-link').click();
  expect(window.location.hash).toBe('#activity-settings');
});

test('follows history navigation and ignores Settings until it is enabled', () => {
  const navigation = createPageNavigation();
  window.history.pushState(null, '', '#activity-settings');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(element('#activity-settings').hidden).toBe(true);

  navigation.enableSettings();
  expect(element('#activity-settings').hidden).toBe(false);
  window.history.pushState(null, '', '#catalog-heading');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(element('#catalog-page').hidden).toBe(false);
});

test('shows the game page once it is enabled and notifies on every visit', () => {
  const navigation = createPageNavigation();
  window.history.pushState(null, '', '#activity-game');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(element('#activity-game').hidden).toBe(true);
  expect(element('#game-link').hidden).toBe(true);

  let opened = 0;
  navigation.enableGame(() => {
    opened += 1;
  });
  // Enabling honors the fragment already in the URL.
  expect(element('#activity-game').hidden).toBe(false);
  expect(element('#catalog-page').hidden).toBe(true);
  expect(element('#composer-pane').hidden).toBe(true);
  expect(element('#game-link').getAttribute('aria-current')).toBe('page');
  expect(opened).toBe(1);

  element('#catalog-link').click();
  expect(element('#activity-game').hidden).toBe(true);
  expect(element('#game-link').getAttribute('aria-current')).toBe('false');
  element('#game-link').click();
  expect(window.location.hash).toBe('#activity-game');
  expect(document.activeElement).toBe(element('#game-heading'));
  expect(element('#activity-settings').hidden).toBe(true);
  expect(opened).toBe(2);
});

test('resets the scroll before the game page positions itself', () => {
  const navigation = createPageNavigation();
  const events: string[] = [];
  const root = document.documentElement;
  Object.defineProperty(root, 'scrollTop', {
    configurable: true,
    set(): void {
      events.push('scroll reset');
    }
  });
  navigation.enableGame(() => {
    events.push('game opened');
  });
  element('#game-link').click();
  // Opening centers the start button; a later reset would throw that position away.
  expect(events).toEqual(['scroll reset', 'game opened']);
  Reflect.deleteProperty(root, 'scrollTop');
});

test('closes the catalog while a match is running', () => {
  const navigation = createPageNavigation();
  navigation.enableSettings();
  navigation.enableGame(() => undefined);
  expect(
    [...document.querySelectorAll('.workspace-nav a')].map(
      (link: Readonly<Pick<Element, 'id'>>) => link.id
    )
  ).toEqual(['catalog-link', 'game-link', 'settings-link']);

  // A player still browsing the catalog is moved to the game when a match starts.
  navigation.lockCatalog(true);
  expect(element('#activity-game').hidden).toBe(false);
  expect(element('#catalog-page').hidden).toBe(true);
  expect(window.location.hash).toBe('#activity-game');
  expect(element('#catalog-link').getAttribute('aria-disabled')).toBe('true');

  element('#catalog-link').click();
  expect(element('#catalog-page').hidden).toBe(true);
  window.history.pushState(null, '', '#catalog-heading');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(element('#catalog-page').hidden).toBe(true);
  expect(window.location.hash).toBe('#activity-game');

  // Settings stays reachable, and locking leaves a visitor there alone.
  element('#settings-link').click();
  navigation.lockCatalog(true);
  expect(element('#activity-settings').hidden).toBe(false);

  navigation.lockCatalog(false);
  expect(element('#catalog-link').getAttribute('aria-disabled')).toBe('false');
  element('#catalog-link').click();
  expect(element('#catalog-page').hidden).toBe(false);
});
