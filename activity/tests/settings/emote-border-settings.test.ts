// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import { mountEmoteBorderSettings } from '../../src/settings/emote-border-settings.ts';
import { requireValue } from '../../src/validation.ts';

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

function panel(): HTMLDetailsElement {
  return requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
    'Missing emote border panel.'
  );
}

test('loads a saved color, saves a new choice, and disables the border', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ color: 'FF7700' })
    .mockResolvedValueOnce({ color: '4488CC' })
    .mockResolvedValueOnce({ color: '' });
  mountEmoteBorderSettings(request);
  const settings = panel();
  expect(settings.hidden).toBe(false);
  settings.open = true;
  const enabled = requireValue(
    settings.querySelector<HTMLInputElement>('input[type="checkbox"]'),
    'Missing toggle.'
  );
  const picker = requireValue(
    settings.querySelector<HTMLInputElement>('input[type="color"]'),
    'Missing color picker.'
  );
  const save = requireValue(settings.querySelector('button'), 'Missing save button.');
  await vi.waitFor(() => {
    expect(enabled.checked).toBe(true);
    expect(picker.disabled).toBe(false);
    expect(picker.value).toBe('#ff7700');
  });

  picker.value = '#4488cc';
  save.click();
  await vi.waitFor(() => {
    expect(settings.querySelector('[role="status"]')?.textContent).toBe('Emote border saved.');
  });
  expect(request).toHaveBeenLastCalledWith('#4488cc');

  enabled.click();
  expect(picker.disabled).toBe(true);
  save.click();
  await vi.waitFor(() => {
    expect(settings.getAttribute('aria-busy')).toBeNull();
  });
  expect(request).toHaveBeenLastCalledWith('');
  expect(enabled.checked).toBe(false);
  expect(picker.value).toBe('#4488cc');
  enabled.click();
  expect(picker.disabled).toBe(false);
});

test.each([
  [null, 'Invalid emote border response.'],
  [{ color: 123 }, 'Invalid emote border response.'],
  [{ color: 'blue' }, 'Invalid emote border response.'],
  [{ message: 'Access denied.' }, 'Access denied.']
])('reports an invalid response %#', async (response: unknown, message: string) => {
  mountEmoteBorderSettings(async () => await Promise.resolve(response));
  const settings = panel();
  settings.open = true;
  await vi.waitFor(() => {
    expect(settings.querySelector('[role="status"]')?.textContent).toBe(message);
  });
  expect(settings.querySelector('fieldset')?.disabled).toBe(true);
});
