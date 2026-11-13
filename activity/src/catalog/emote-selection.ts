/* Owns bounded emote selection and its bulk-action toolbar. */

import type { BrowserEmote } from './catalog.ts';
import type { createComposer } from '../composer/composer.ts';
import { requireValue } from '../validation.ts';

const MAX_SELECTION = 12;

/** Operations supplied by the catalog and composer. */
type SelectionOptions = {
  readonly composer: Pick<ReturnType<typeof createComposer>, 'addMany'>;
  readonly canChange: (emote: BrowserEmote, removing: boolean) => boolean;
  readonly isBusy: () => boolean;
};

/** Read access and explicit mutations for a bounded selection. */
type EmoteSelection = {
  /** Binds server actions once, after Discord initialization. */
  readonly connectChanges: (change: (removing: boolean) => void) => void;
  readonly active: boolean;
  readonly entries: () => readonly BrowserEmote[];
  readonly has: (key: string) => boolean;
  readonly toggle: (emote: BrowserEmote) => void;
  readonly clear: () => void;
  readonly refresh: (feedback?: string) => void;
  readonly removeSucceeded: (ids: readonly string[]) => void;
};

/**
 * Identifies a tile consistently across catalog refreshes and discovery results.
 * @param emote - Validated browser metadata.
 * @returns A key including provider, provider ID or image, and name.
 */
export function emoteKey(emote: BrowserEmote): string {
  return JSON.stringify([emote.source, emote.sevenTVId ?? emote.image, emote.name]);
}

/**
 * Mounts selection controls and preserves failed bulk items for retry.
 * @param options - Composer, permission checks, and bulk action callbacks.
 * @returns Selection queries and explicit state updates.
 * @throws `Error` if required selection markup is missing.
 */
export function createEmoteSelection(options: SelectionOptions): EmoteSelection {
  const selectEmotes = requireValue(
    document.querySelector<HTMLButtonElement>('#select-emotes'),
    'Missing selection toggle.'
  );
  const selectionPanel = requireValue(
    document.querySelector<HTMLElement>('#selection'),
    'Missing selection panel.'
  );
  const selectionStatus = requireValue(
    document.querySelector('#selection-status'),
    'Missing selection status.'
  );
  const selectionCompose = requireValue(
    document.querySelector<HTMLButtonElement>('#selection-compose'),
    'Missing bulk compose.'
  );
  const selectionAdd = requireValue(
    document.querySelector<HTMLButtonElement>('#selection-add'),
    'Missing bulk add.'
  );
  const selectionRemove = requireValue(
    document.querySelector<HTMLButtonElement>('#selection-remove'),
    'Missing bulk remove.'
  );
  const selectionClear = requireValue(
    document.querySelector<HTMLButtonElement>('#selection-clear'),
    'Missing clear selection.'
  );
  const results = requireValue(document.querySelector('#results'), 'Missing results.');
  let selecting = false;
  const selection = new Map<string, BrowserEmote>();

  function syncSelection(feedback?: string): void {
    selectionPanel.hidden = !selecting;
    selectEmotes.setAttribute('aria-pressed', String(selecting));
    selectEmotes.textContent = selecting ? 'Done selecting' : 'Select emotes';
    selectionStatus.textContent = feedback ?? `${selection.size} of ${MAX_SELECTION} selected`;
    const entries: readonly BrowserEmote[] = [...selection.values()];
    const busy = options.isBusy();
    selectionAdd.hidden = !entries.some((emote) => options.canChange(emote, false));
    selectionRemove.hidden = !entries.some((emote) => options.canChange(emote, true));
    selectionAdd.disabled = busy;
    selectionRemove.disabled = busy;
    selectionCompose.disabled = !entries.some((emote) => emote.composeToken !== undefined);
    selectionClear.disabled = entries.length === 0;
    for (const tile of results.querySelectorAll<HTMLButtonElement>('.tile')) {
      if (selecting)
        tile.setAttribute('aria-pressed', String(selection.has(tile.dataset['key'] ?? '')));
      else tile.removeAttribute('aria-pressed');
    }
  }

  function clearSelection(): void {
    selection.clear();
    syncSelection();
  }

  function toggleSelection(emote: BrowserEmote): void {
    const key = emoteKey(emote);
    if (selection.has(key)) selection.delete(key);
    else if (selection.size < MAX_SELECTION) selection.set(key, emote);
    else {
      syncSelection(`Select up to ${MAX_SELECTION} emotes at a time.`);
      return;
    }
    syncSelection();
  }
  selectEmotes.addEventListener('click', () => {
    selecting = !selecting;
    clearSelection();
  });
  selectionClear.addEventListener('click', clearSelection);
  selectionCompose.addEventListener('click', () => {
    const count = options.composer.addMany([...selection.values()]);
    syncSelection(
      count === 0 ?
        'The composer is full. Remove an input to add more.'
      : `Added ${count} to the composer.`
    );
  });
  return {
    connectChanges(change): void {
      selectionAdd.addEventListener('click', () => {
        change(false);
      });
      selectionRemove.addEventListener('click', () => {
        change(true);
      });
    },
    get active(): boolean {
      return selecting;
    },
    entries: () => [...selection.values()],
    has: (key) => selection.has(key),
    toggle: toggleSelection,
    clear: clearSelection,
    refresh: syncSelection,
    removeSucceeded(ids): void {
      for (const [key, emote] of selection) {
        if (emote.sevenTVId !== undefined && ids.includes(emote.sevenTVId)) selection.delete(key);
      }
    }
  };
}
