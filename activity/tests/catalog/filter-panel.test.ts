// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

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

function source(): HTMLSelectElement {
  return requireValue(document.querySelector<HTMLSelectElement>('#source'), 'Missing source');
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

test('expands the secondary filters and counts only applicable active fields', () => {
  const filters = createFilterPanel();
  expect(element('#advanced-filters').hidden).toBe(true);
  expect(element('#filter-count').hidden).toBe(true);
  expect(clearAction().disabled).toBe(true);

  element('#filters-toggle').click();
  expect(element('#advanced-filters').hidden).toBe(false);
  expect(element('#filters-toggle').getAttribute('aria-expanded')).toBe('true');

  field('#motion').value = 'animated';
  field('#tag-search').value = 'dance';
  source().add(new Option('7TV', '7TV'));
  source().value = '7TV';
  filters.update();
  expect(element('#filter-count').textContent).toBe('3');

  // Discovery modes hide the platform filter, so it no longer applies.
  element('#source-filter').hidden = true;
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
