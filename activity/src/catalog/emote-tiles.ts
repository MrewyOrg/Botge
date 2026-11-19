/* Renders catalog tiles with their composer shortcut and right-click emote menu. */

import type { BrowserEmote } from './catalog.ts';
import type { createComposer } from '../composer/composer.ts';
import { createContextMenu } from '../context-menu.ts';
import type { createEmoteAccess } from './emote-access.ts';
import type { createEmotePreview } from './emote-preview.ts';
import { type createEmoteSelection, emoteKey } from './emote-selection.ts';
import { requireValue } from '../validation.ts';

/**
 * Starts one server change for an emote.
 * @param emote - The emote to add or remove.
 * @param removing - `true` to remove, `false` to add.
 * @param report - Shows progress and the outcome.
 */
type EmoteChange = (
  emote: BrowserEmote,
  removing: boolean,
  report: (feedback: string) => void
) => void;

type TileOptions = {
  readonly composer: Pick<ReturnType<typeof createComposer>, 'add' | 'full'>;
  readonly access: Pick<ReturnType<typeof createEmoteAccess>, 'canChange' | 'isBusy'>;
  readonly selection: Pick<
    ReturnType<typeof createEmoteSelection>,
    'active' | 'has' | 'toggle' | 'refresh'
  >;
  readonly preview: Pick<ReturnType<typeof createEmotePreview>, 'show'>;
  /** Shows a catalog status message. */
  readonly report: (feedback: string) => void;
};

/**
 * Creates the tile renderer and attaches the emote menu to the results list.
 *
 * @remarks
 * A tile opens the preview, or toggles the emote while selecting. Emotes with a compose token get
 * a one-click composer button. Right-clicking a tile offers composer, server, and details actions.
 *
 * @param options - Composer, access state, selection, preview, and status reporting.
 * @returns A tile factory and a way to connect server changes to the menu.
 * @throws `Error` if the results list is missing.
 */
export function createEmoteTiles(options: TileOptions): {
  /**
   * Builds one list item for an emote.
   * @param emote - Catalog or decorated discovery entry.
   * @param showComposerShortcut - Whether to show the tile's composer shortcut.
   */
  readonly make: (emote: BrowserEmote, showComposerShortcut?: boolean) => HTMLLIElement;
  /**
   * Enables the menu's add and remove actions.
   * @param change - Starts a server change for the chosen emote.
   */
  readonly connectChanges: (change: EmoteChange) => void;
} {
  const { composer, access, selection, preview, report } = options;
  const results = requireValue(
    document.querySelector<HTMLUListElement>('#results'),
    'Missing results.'
  );
  const menu = createContextMenu();
  const tileEmotes = new WeakMap<Element, BrowserEmote>();
  // Server actions stay hidden until a change handler is connected.
  let change: EmoteChange = () => undefined;

  function compose(emote: BrowserEmote): void {
    composer.add(emote);
    selection.refresh();
  }

  function make(emote: BrowserEmote, showComposerShortcut = true): HTMLLIElement {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    const key = emoteKey(emote);
    button.dataset['key'] = key;
    if (selection.active) button.setAttribute('aria-pressed', String(selection.has(key)));
    button.addEventListener('click', () => {
      if (selection.active) selection.toggle(emote);
      else preview.show(emote);
    });
    tileEmotes.set(button, emote);

    const image = document.createElement('img');
    image.src = emote.image;
    image.alt = '';
    image.width = 64;
    image.height = 64;
    image.loading = 'lazy';
    const art = document.createElement('span');
    art.className = 'tile-art';
    art.append(image);

    const details = document.createElement('span');
    details.className = 'tile-details';
    const name = document.createElement('strong');
    name.textContent = emote.name;
    const label = document.createElement('span');
    const labels = [emote.source];
    if (emote.added === true) labels.push('Added');
    if (emote.animated) labels.push('Animated');
    if (emote.overlaying === true) labels.push('Overlaying');
    label.textContent = labels.join(' · ');
    details.append(name, label);
    button.append(art, details);
    item.append(button);

    if (showComposerShortcut && emote.composeToken !== undefined) {
      // A sibling of the tile, because interactive content cannot nest inside a button.
      const shortcut = document.createElement('button');
      shortcut.type = 'button';
      shortcut.className = 'tile-compose';
      shortcut.textContent = '+';
      shortcut.title = 'Add to composer';
      shortcut.setAttribute('aria-label', `Add ${emote.name} to composer`);
      shortcut.addEventListener('click', () => {
        if (composer.full()) report('The composer is full.');
        else compose(emote);
      });
      item.append(shortcut);
    }
    return item;
  }

  results.addEventListener(
    'contextmenu',
    (
      event: Readonly<{
        target: unknown;
        clientX: number;
        clientY: number;
        preventDefault: () => void;
      }>
    ) => {
      const tile =
        event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.tile') : null;
      const emote = tile === null ? undefined : tileEmotes.get(tile);
      if (tile === null || emote === undefined) return;
      event.preventDefault();
      const actions: { label: string; run: () => void }[] = [];
      if (emote.composeToken !== undefined && !composer.full())
        actions.push({
          label: 'Add to composer',
          run(): void {
            compose(emote);
          }
        });
      const start = change;
      for (const removing of [false, true] as const) {
        if (!access.canChange(emote, removing) || access.isBusy()) continue;
        actions.push({
          label: removing ? 'Remove from this server' : 'Add to this server',
          run(): void {
            start(emote, removing, report);
          }
        });
      }
      actions.push({
        label: 'View details',
        run(): void {
          preview.show(emote);
        }
      });
      menu.open(tile, event.clientX, event.clientY, actions);
    }
  );

  return {
    make,
    connectChanges(handler): void {
      change = handler;
    }
  };
}
