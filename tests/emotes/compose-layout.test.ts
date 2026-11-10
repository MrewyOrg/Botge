import { expect, test } from 'vitest';

import { groupEmoteLayers, isComposeToken } from 'src/emotes/rendering/compose-layout.ts';

test('groups normal emotes horizontally and zero-width emotes over the preceding base', () => {
  const items = ['First', 'OverlayA', 'OverlayB', 'Second', 'OverlayC'];
  const isOverlay = (name: string): boolean => name.startsWith('Overlay');
  expect(groupEmoteLayers(items, isOverlay)).toEqual([
    { start: 0, layers: ['First', 'OverlayA', 'OverlayB'] },
    { start: 3, layers: ['Second', 'OverlayC'] }
  ]);
  expect(groupEmoteLayers(['OverlayA', 'OverlayB', 'First'], isOverlay)).toEqual([
    { start: 0, layers: ['OverlayA', 'OverlayB'] },
    { start: 2, layers: ['First'] }
  ]);
  expect(groupEmoteLayers([], isOverlay)).toEqual([]);
});

test('compose tokens are single names that the bot can look up', () => {
  expect(isComposeToken('Wave')).toBe(true);
  expect(isComposeToken('Two words')).toBe(false);
  expect(isComposeToken('A')).toBe(false);
  expect(isComposeToken(undefined)).toBe(false);
});
