// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import html from '../../index.html?raw';
import type { BrowserEmote } from '../../src/catalog/catalog.ts';
import { MAX_EMOTE_COMPOSE_INPUTS } from '../../src/composer/compose-layout.ts';
import { createComposer } from '../../src/composer/composer.ts';
import { requireValue } from '../../src/validation.ts';

const base = {
  name: 'Wave',
  composeToken: 'Wave',
  source: '7TV',
  image: 'wave.webp',
  animated: false
};
const overlay = { ...base, name: 'Hat', composeToken: 'Hat', overlaying: true };
const other = { ...base, name: 'Smile', composeToken: 'Smile' };

function element(selector: string): HTMLElement {
  return requireValue(document.querySelector<HTMLElement>(selector), `Missing ${selector}`);
}

function tokens(): string {
  return requireValue(
    document.querySelector<HTMLInputElement>('#composer-input'),
    'Missing composer input'
  ).value;
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

test('layers overlays, reorders inputs, removes inputs, and clears the preview', () => {
  const composer = createComposer();
  expect(element('#composer-copy').hasAttribute('disabled')).toBe(true);
  for (const emote of [base, overlay, other]) composer.add(emote);
  expect(tokens()).toBe('Wave Hat Smile');
  expect(document.querySelectorAll('.composer-column')).toHaveLength(2);
  expect(document.querySelectorAll('.composer-column:first-child img')).toHaveLength(2);

  element('button[aria-label="Move earlier Smile"]').click();
  expect(tokens()).toBe('Wave Smile Hat');
  element('button[aria-label="Move later Wave"]').click();
  expect(tokens()).toBe('Smile Wave Hat');
  element('button[aria-label="Remove Wave"]').click();
  expect(tokens()).toBe('Smile Hat');
  expect(document.querySelectorAll('.composer-column')).toHaveLength(1);
  element('button[aria-label="Remove Smile"]').click();
  expect(document.activeElement).toBe(element('button[aria-label="Remove Hat"]'));
  element('button[aria-label="Remove Hat"]').click();
  expect(document.activeElement).toBe(element('#composer summary'));
  expect(tokens()).toBe('');

  composer.add(base);
  element('#composer-clear').click();
  expect(tokens()).toBe('');
  expect(document.querySelectorAll('.composer-column')).toHaveLength(0);
});

test('ignores emotes without a compose token and stops at the composition limit', () => {
  const composer = createComposer();
  const withoutToken: BrowserEmote = {
    name: 'Wave',
    source: '7TV',
    image: 'wave.webp',
    animated: false
  };
  composer.add(withoutToken);
  expect(tokens()).toBe('');
  for (let index = 0; index < MAX_EMOTE_COMPOSE_INPUTS; index += 1) composer.add(base);
  expect(composer.full()).toBe(true);
  composer.add(other);
  expect(tokens().split(' ')).toHaveLength(MAX_EMOTE_COMPOSE_INPUTS);
});

test('copies composition tokens or selects the input when clipboard access fails', async () => {
  const writeText = vi
    .fn<() => Promise<void>>()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error('Clipboard unavailable'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    createComposer().add(base);
    element('#composer-copy').click();
    await vi.waitFor(() => {
      expect(element('#composer-feedback').textContent).toContain('Copied.');
    });
    expect(writeText).toHaveBeenCalledWith('Wave');
    element('#composer-copy').click();
    await vi.waitFor(() => {
      expect(element('#composer-feedback').textContent).toContain('Inputs selected.');
    });
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('fails clearly when the composer markup is missing', () => {
  element('#composer').remove();
  expect(() => createComposer()).toThrow('Missing composer.');
});
