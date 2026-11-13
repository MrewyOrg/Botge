/* Keeps composition order, preview columns, and copied command tokens in sync. */

import type { BrowserEmote } from '../catalog/catalog.ts';
import { groupEmoteLayers, MAX_EMOTE_COMPOSE_INPUTS } from './compose-layout.ts';
import { requireValue } from '../validation.ts';

/**
 * Mounts an empty composer and keeps its preview and command tokens synchronized.
 *
 * @remarks
 * Adding or clearing layers redraws the controls. Reordering and removal restore keyboard
 * focus to a surviving action. Inputs without compose tokens are ignored.
 *
 * @returns Controls for adding layers and checking the shared composition limit.
 * @throws `Error` if required composer markup is missing.
 * @see {@link MAX_EMOTE_COMPOSE_INPUTS}
 * @see {@link groupEmoteLayers}
 */
export function createComposer(): {
  /**
   * Adds one composable emote if capacity remains.
   * @param emote - Catalog or discovery entry.
   */
  readonly add: (emote: BrowserEmote) => void;
  /**
   * Adds composable entries in order, stopping at the input limit.
   * @param emotes - Candidate layers in selection order.
   * @returns The number of entries accepted.
   */
  readonly addMany: (emotes: readonly BrowserEmote[]) => number;
  /** Reports whether the composer has reached its input limit. */
  readonly full: () => boolean;
} {
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#composer'),
    'Missing composer.'
  );
  const summary = requireValue(panel.querySelector('summary'), 'Missing composer summary.');
  const preview = requireValue(
    document.querySelector('#composer-preview'),
    'Missing composition preview.'
  );
  const layers = requireValue(document.querySelector('#composer-layers'), 'Missing layers.');
  const input = requireValue(
    document.querySelector<HTMLInputElement>('#composer-input'),
    'Missing emote input.'
  );
  const copy = requireValue(
    document.querySelector<HTMLButtonElement>('#composer-copy'),
    'Missing copy button.'
  );
  const clear = requireValue(
    document.querySelector<HTMLButtonElement>('#composer-clear'),
    'Missing clear button.'
  );
  const feedback = requireValue(
    document.querySelector('#composer-feedback'),
    'Missing composer feedback.'
  );
  const emotes: BrowserEmote[] = [];

  function full(): boolean {
    return emotes.length >= MAX_EMOTE_COMPOSE_INPUTS;
  }

  function move(index: number, offset: number): number {
    const target = index + offset;
    if (target < 0 || target >= emotes.length) return index;
    const [emote] = emotes.splice(index, 1);
    if (emote === undefined) return index;
    emotes.splice(target, 0, emote);
    return target;
  }

  function render(): void {
    function action(
      label: string,
      emote: BrowserEmote,
      handler: () => number,
      disabled = false
    ): HTMLButtonElement {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset['action'] = label;
      button.setAttribute('aria-label', `${label} ${emote.name}`);
      button.disabled = disabled;
      button.addEventListener('click', () => {
        const index = handler();
        render();
        // Rendering replaces the buttons. Restore focus to an equivalent surviving action.
        const row = layers.children.item(Math.min(index, emotes.length - 1));
        const next =
          row?.querySelector<HTMLButtonElement>(`button[data-action="${label}"]:enabled`)
          ?? row?.querySelector<HTMLButtonElement>('button:enabled')
          ?? summary;
        next.focus();
      });
      return button;
    }

    const groups = groupEmoteLayers(emotes, (emote) => emote.overlaying === true);
    preview.replaceChildren();
    layers.replaceChildren();
    for (const group of groups) {
      const column = document.createElement('div');
      column.className = 'composer-column';
      for (const emote of group.layers) {
        const image = document.createElement('img');
        image.src = emote.image;
        image.alt = emote.name;
        column.append(image);
      }
      preview.append(column);
    }
    for (const [index, emote] of emotes.entries()) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = emote.overlaying === true ? `${emote.name} · Overlaying` : emote.name;
      row.append(
        name,
        action('Move earlier', emote, () => move(index, -1), index === 0),
        action('Move later', emote, () => move(index, 1), index === emotes.length - 1),
        action('Remove', emote, () => {
          emotes.splice(index, 1);
          return index;
        })
      );
      layers.append(row);
    }

    input.value = emotes.map((emote) => emote.composeToken).join(' ');
    copy.disabled = emotes.length === 0;
    clear.disabled = emotes.length === 0;
    feedback.textContent = `${emotes.length} of ${MAX_EMOTE_COMPOSE_INPUTS} inputs`;
  }

  async function copyComposition(): Promise<void> {
    try {
      await navigator.clipboard.writeText(input.value);
      feedback.textContent = 'Copied. Paste into the emotes field of /emote-compose.';
    } catch {
      input.focus();
      input.select();
      feedback.textContent = 'Inputs selected. Use your device’s copy command.';
    }
  }

  copy.addEventListener('click', () => {
    void copyComposition();
  });
  clear.addEventListener('click', () => {
    emotes.length = 0;
    render();
    summary.focus();
  });
  render();

  function addMany(items: readonly BrowserEmote[]): number {
    const added: readonly BrowserEmote[] = items
      .values()
      .filter((emote) => emote.composeToken !== undefined)
      .take(MAX_EMOTE_COMPOSE_INPUTS - emotes.length)
      .toArray();
    if (added.length > 0) {
      emotes.push(...added);
      panel.open = true;
      render();
    }
    return added.length;
  }

  return {
    full,
    add(emote: BrowserEmote): void {
      addMany([emote]);
    },
    addMany
  };
}
