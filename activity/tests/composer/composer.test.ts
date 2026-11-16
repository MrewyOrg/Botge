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
} as const;
const overlay = { ...base, name: 'Hat', composeToken: 'Hat', overlaying: true } as const;
const other = { ...base, name: 'Smile', composeToken: 'Smile' } as const;

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
  for (const emote of [base, overlay, other] as const) composer.add(emote);
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

test('stays collapsed in the compact layout and counts added layers', () => {
  const matchMedia = vi.fn((query: string) => ({ matches: query === '(max-width: 48rem)' }));
  vi.stubGlobal('matchMedia', matchMedia);
  try {
    const composer = createComposer();
    expect(document.querySelector('#composer[open]')).toBeNull();
    expect(element('#composer-count').hidden).toBe(true);
    composer.add(base);
    composer.add(overlay);
    expect(document.querySelector('#composer[open]')).toBeNull();
    expect(element('#composer-count').hidden).toBe(false);
    expect(element('#composer-count').textContent).toBe('2');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('opens when a layer is added in the wide layout', () => {
  const composer = createComposer();
  requireValue(document.querySelector<HTMLDetailsElement>('#composer'), 'Missing composer').open =
    false;
  composer.add(base);
  expect(document.querySelector('#composer[open]')).not.toBeNull();
});

test('ignores emotes without a compose token and stops at the composition limit', () => {
  const composer = createComposer();
  const withoutToken: BrowserEmote = {
    name: 'Wave',
    source: '7TV',
    image: 'wave.webp',
    animated: false
  } as const;
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

test('ignores stale reorder controls and out-of-range moves', () => {
  const composer = createComposer();
  composer.addMany([base, other]);
  const earlier = requireValue(
    document.querySelector<HTMLButtonElement>('button[aria-label="Move earlier Wave"]'),
    'Missing reorder control'
  );
  earlier.disabled = false;
  earlier.click();
  expect(tokens()).toBe('Wave Smile');
  const stale = element('button[aria-label="Move earlier Smile"]');
  element('button[aria-label="Remove Smile"]').click();
  stale.click();
  expect(tokens()).toBe('Wave');
});

test('draws the saved border around the whole preview canvas', () => {
  const composer = createComposer();
  composer.setBorder('#f0b232');
  expect(document.querySelector('.composer-canvas')).toBeNull();
  composer.add(base);
  composer.add(other);
  const canvas = element('.composer-canvas');
  expect(canvas.dataset['border']).toBe('#f0b232');
  expect(canvas.style.getPropertyValue('--emote-border')).toBe('#f0b232');
  expect(canvas.querySelectorAll('.composer-column')).toHaveLength(2);
  composer.setBorder(undefined);
  expect(element('.composer-canvas').hasAttribute('data-border')).toBe(false);
});
