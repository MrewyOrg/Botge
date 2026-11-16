// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { createEmotePreview } from '../../src/catalog/emote-preview.ts';
import {
  click,
  element,
  previewDialog,
  publicEmote,
  waitForText
} from '../fixtures/activity-page.ts';

test('ignores stale action feedback and catalog updates after switching previews', async () => {
  const pending = Promise.withResolvers<undefined>();
  const changed = vi.fn();
  const preview = createEmotePreview({
    composer: { add: vi.fn(), addMany: vi.fn(), full: () => false },
    canChange: () => true,
    isBusy: () => false,
    onCompose: vi.fn(),
    openExternal: undefined,
    linkSevenTV: true
  });
  preview.connectChanges(async (_emote, _removing, report): Promise<void> => {
    await pending.promise;
    report('Saved.');
    changed();
  });
  preview.show(publicEmote);
  click('#add');
  const other = { ...publicEmote, name: 'Other' } as const;
  preview.show(other);
  preview.refreshActions(publicEmote);
  pending.resolve(undefined);
  await vi.waitFor(() => {
    expect(changed).toHaveBeenCalledOnce();
  });
  expect(element('#preview-title').textContent).toBe('Other');
  expect(element('#copy-message').textContent).toBe('');
  click('#remove');
  await waitForText('#copy-message', 'Saved.');
});

test('ignores a compose event before any preview has been selected', () => {
  const add = vi.fn();
  createEmotePreview({
    composer: { add, addMany: vi.fn(), full: () => false },
    canChange: () => false,
    isBusy: () => false,
    onCompose: vi.fn(),
    openExternal: undefined,
    linkSevenTV: true
  });
  element('#compose-add').dispatchEvent(new MouseEvent('click'));
  expect(add).not.toHaveBeenCalled();
});

test('closes on a backdrop click but not on clicks or drags that start inside', () => {
  const preview = createEmotePreview({
    composer: { add: vi.fn(), addMany: vi.fn(), full: () => false },
    canChange: () => false,
    isBusy: () => false,
    onCompose: vi.fn(),
    openExternal: undefined,
    linkSevenTV: true
  });
  const dialog = previewDialog();
  dialog.getBoundingClientRect = (): DOMRect => new DOMRect(100, 100, 200, 200);
  const pointer = (
    target: Readonly<Pick<EventTarget, 'dispatchEvent'>>,
    type: string,
    x: number,
    y: number
  ): void => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  };
  const press = (
    target: Readonly<Pick<EventTarget, 'dispatchEvent'>>,
    start: readonly [number, number],
    end = start
  ): void => {
    pointer(target, 'pointerdown', ...start);
    pointer(target, 'click', ...end);
  };

  preview.show(publicEmote);
  expect(document.activeElement).toBe(dialog);
  press(dialog, [150, 150]);
  press(element('#preview-title'), [150, 150], [20, 20]);
  press(dialog, [150, 150], [20, 20]);
  press(dialog, [20, 20], [150, 150]);
  expect(dialog.open).toBe(true);

  for (const point of [
    [20, 150],
    [350, 150],
    [150, 20],
    [150, 350]
  ] as const) {
    preview.show(publicEmote);
    press(dialog, point);
    expect(dialog.open).toBe(false);
  }
});
