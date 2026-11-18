// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { requireValue } from '../../src/validation.ts';
import { click, element, input, previewDialog, waitForText } from '../fixtures/activity-page.ts';

test('runs every guild feature against the in-memory demo outside Discord', async () => {
  vi.stubEnv('VITE_ENABLE_ACTIVITY_DEMO', 'true');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);

  await import('../../src/index.ts');
  await waitForText('#message', 'Showing 10 of 10');
  // The saved border loads at startup and frames the composer preview.
  click('#results .tile-compose');
  await vi.waitFor(() => {
    expect(element('.composer-canvas').dataset['border']).toBe('#f0b232');
  });
  expect(element('#demo-notice').hidden).toBe(false);
  expect(element('#demo-notice').textContent).toContain('real 7TV emotes');
  expect(element('#demo-notice').textContent).toContain('not affiliated with Discord or 7TV');
  expect(element('#settings-link').hidden).toBe(false);
  expect(element('#browse-modes').hidden).toBe(false);
  // Try again appears only after a failed catalog load.
  expect(element('#refresh-catalog').hidden).toBe(true);
  expect(element('#added-filter').hidden).toBe(false);

  click('#trending-mode');
  await waitForText('#message', 'Showing 24 7TV emotes');
  const target = [...document.querySelectorAll<HTMLButtonElement>('#results .tile')].find(
    (tile: Readonly<Pick<HTMLButtonElement, 'textContent'>>) =>
      tile.textContent.startsWith('Think') && !tile.textContent.includes('Added')
  );
  target?.click();
  // Placeholder IDs have no 7TV page, so the demo hides the link.
  expect(element('#open-7tv').hidden).toBe(true);
  click('#add');
  await waitForText('#copy-message', 'Added Think to this server.');
  expect(element('#add').hidden).toBe(true);
  previewDialog().close();

  click('#settings-link');
  const border = requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
    'Missing emote border settings'
  );
  border.open = true;
  border.dispatchEvent(new Event('toggle'));
  await vi.waitFor(() => {
    expect(border.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#f0b232');
  });
  input('#emote-border-settings input[type="color"]').value = '#4488cc';
  click('#emote-border-settings button[type="submit"]');
  await vi.waitFor(() => {
    expect(element('.composer-canvas').dataset['border']).toBe('#4488cc');
  });
  // The demo answers from memory, so the page never reaches the network.
  expect(fetch).not.toHaveBeenCalled();
});
