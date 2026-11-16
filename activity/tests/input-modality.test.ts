// @vitest-environment jsdom

import { expect, test } from 'vitest';

import { trackInputModality } from '../src/input-modality.ts';

test('records the latest input method before other handlers run', () => {
  trackInputModality();
  const root = document.documentElement;
  expect(root.dataset['input']).toBeUndefined();

  let seen: string | undefined;
  document.body.addEventListener('pointerdown', () => {
    seen = root.dataset['input'];
  });
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(seen).toBe('pointer');

  document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
  expect(root.dataset['input']).toBe('keyboard');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(root.dataset['input']).toBe('pointer');
});
