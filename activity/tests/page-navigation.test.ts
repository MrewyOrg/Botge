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
