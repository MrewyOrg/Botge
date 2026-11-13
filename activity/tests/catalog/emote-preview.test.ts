// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { createEmotePreview } from '../../src/catalog/emote-preview.ts';
import { click, element, publicEmote, waitForText } from '../fixtures/activity-page.ts';

test('ignores stale action feedback and catalog updates after switching previews', async () => {
  const pending = Promise.withResolvers<undefined>();
  const changed = vi.fn();
  const preview = createEmotePreview({
    composer: { add: vi.fn(), addMany: vi.fn(), full: () => false },
    canChange: () => true,
    isBusy: () => false,
    onCompose: vi.fn(),
    openExternal: undefined
  });
  preview.connectChanges(async (_emote, _removing, report): Promise<void> => {
    await pending.promise;
    report('Saved.');
    changed();
  });
  preview.show(publicEmote);
  click('#add');
  const other = { ...publicEmote, name: 'Other' };
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
    openExternal: undefined
  });
  element('#compose-add').dispatchEvent(new MouseEvent('click'));
  expect(add).not.toHaveBeenCalled();
});
