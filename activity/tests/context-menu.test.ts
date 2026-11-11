// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from 'vitest';

import { createContextMenu } from '../src/context-menu.ts';
import { requireValue } from '../src/validation.ts';

beforeEach(() => {
  document.body.innerHTML =
    '<button id="tile">Emote</button><div id="emote-context-menu" hidden></div>';
});

function fixture(): Readonly<{ tile: HTMLButtonElement; menu: HTMLElement }> {
  return {
    tile: requireValue(document.querySelector<HTMLButtonElement>('#tile'), 'Missing tile.'),
    menu: requireValue(document.querySelector<HTMLElement>('#emote-context-menu'), 'Missing menu.')
  };
}

test('opens beside the pointer and clamps to the viewport', () => {
  const { tile, menu } = fixture();
  Object.defineProperty(menu, 'offsetWidth', { value: 160 });
  Object.defineProperty(menu, 'offsetHeight', { value: 80 });
  const action = vi.fn();
  const context = createContextMenu();
  context.open(tile, window.innerWidth, window.innerHeight, [{ label: 'Compose', run: action }]);
  expect(menu.style.left).toBe(`${window.innerWidth - 168}px`);
  expect(menu.style.top).toBe(`${window.innerHeight - 88}px`);
  expect(menu.hidden).toBe(false);
  menu.querySelector('button')?.click();
  expect(action).toHaveBeenCalledOnce();
  expect(menu.hidden).toBe(true);
  expect(document.activeElement).toBe(tile);
});

test('uses the tile as a keyboard anchor and supports navigation and dismissal', () => {
  const { tile, menu } = fixture();
  const context = createContextMenu();
  const actions = [
    { label: 'Compose', run: vi.fn() },
    { label: 'Details', run: vi.fn() }
  ];
  context.open(tile, 0, 0, actions);
  const key = (value: string): boolean =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value })
    ) ?? true;
  expect(document.activeElement?.textContent).toBe('Compose');
  key('ArrowUp');
  expect(document.activeElement?.textContent).toBe('Details');
  key('ArrowDown');
  expect(document.activeElement?.textContent).toBe('Compose');
  key('End');
  key('Home');
  key('x');
  expect(key('Escape')).toBe(false);
  expect(menu.hidden).toBe(true);
  expect(document.activeElement).toBe(tile);

  context.open(tile, 20, 25, actions);
  expect(key('Tab')).toBe(true);
  expect(menu.hidden).toBe(true);
  context.open(tile, 20, 25, actions);
  tile.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(menu.hidden).toBe(true);
  context.open(tile, 20, 25, actions);
  window.dispatchEvent(new Event('resize'));
  expect(menu.hidden).toBe(true);
  context.open(tile, 20, 25, actions);
  window.dispatchEvent(new Event('scroll'));
  expect(menu.hidden).toBe(true);
});
