// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import { createFilterPanel } from '../../src/catalog/filter-panel.ts';
import { requireValue } from '../../src/validation.ts';

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

function field(selector: string): HTMLInputElement | HTMLSelectElement {
  return requireValue(
    document.querySelector<HTMLInputElement | HTMLSelectElement>(selector),
    `Missing ${selector}`
  );
}

function clearAction(): HTMLButtonElement {
  return requireValue(
    document.querySelector<HTMLButtonElement>('#clear-filters'),
    'Missing clear filters'
  );
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('expands the secondary filters and counts active fields', () => {
  const filters = createFilterPanel();
  expect(element('#advanced-filters').hidden).toBe(true);
  expect(element('#filter-count').hidden).toBe(true);
  expect(clearAction().disabled).toBe(true);

  element('#filters-toggle').click();
  expect(element('#advanced-filters').hidden).toBe(false);
  expect(element('#filters-toggle').getAttribute('aria-expanded')).toBe('true');

  field('#motion').value = 'animated';
  field('#tag-search').value = 'dance';
  filters.update();
  expect(element('#filter-count').textContent).toBe('2');
  expect(clearAction().disabled).toBe(false);

  element('#filters-toggle').click();
  expect(element('#advanced-filters').hidden).toBe(true);

  // Clearing without a connected handler still resets the fields.
  clearAction().click();
  expect(field('#motion').value).toBe('');
  expect(element('#filter-count').hidden).toBe(true);
});

test('clears the secondary fields but keeps the search text', () => {
  const filters = createFilterPanel();
  const onClear = vi.fn();
  filters.connectClear(onClear);

  field('#search').value = 'wave';
  field('#overlay-filter').value = 'overlaying';
  filters.update();
  element('#clear-filters').click();

  expect(onClear).toHaveBeenCalledOnce();
  expect(field('#overlay-filter').value).toBe('');
  expect(field('#search').value).toBe('wave');
  expect(element('#filter-count').hidden).toBe(true);
});

test('starts with static emotes for reduced motion and allows clearing the filter', () => {
  const matchMedia = vi.fn(() => ({ matches: true }) as const);
  vi.stubGlobal('matchMedia', matchMedia);
  createFilterPanel();

  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(field('#motion').value).toBe('static');
  expect(element('#filter-count').textContent).toBe('1');
  clearAction().click();
  expect(field('#motion').value).toBe('');
});
