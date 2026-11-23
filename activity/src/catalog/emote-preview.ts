/* Owns emote preview state and keeps asynchronous feedback tied to the displayed emote. */

import { type BrowserEmote, emoteTags } from './catalog.ts';
import type { createComposer } from '../composer/composer.ts';
import { requireValue } from '../validation.ts';

/** Capabilities supplied by the catalog, keeping dialog state private. */
type PreviewOptions = {
  readonly composer: Omit<ReturnType<typeof createComposer>, 'setBorder'>;
  readonly canChange: (emote: BrowserEmote, removing: boolean) => boolean;
  readonly isBusy: () => boolean;
  readonly onCompose: () => void;
  readonly openExternal: ((url: string) => Promise<unknown>) | undefined;
  /** Whether 7TV IDs are real; the demo's placeholder IDs have no 7TV page to open. */
  readonly linkSevenTV: boolean;
};

type ChangeEmote = (
  emote: BrowserEmote | undefined,
  removing: boolean,
  report: (feedback: string) => void
) => Promise<void>;

/** Controls for displaying metadata and reflecting changes to the catalog. */
type EmotePreview = {
  /** Binds server actions once, after Discord initialization. */
  readonly connectChanges: (changeEmote: ChangeEmote) => void;
  readonly show: (emote: BrowserEmote) => void;
  readonly refreshActions: (emote: BrowserEmote) => void;
  readonly setBusy: (busy: boolean) => void;
};

/**
 * Mounts the preview dialog, clipboard fallback, and individual emote actions.
 * @param options - Composer and authenticated catalog operations.
 * @returns Controls that preserve the identity of the currently displayed emote.
 * @throws `Error` if required preview markup is missing.
 */
export function createEmotePreview(options: PreviewOptions): EmotePreview {
  const preview = requireValue(
    document.querySelector<HTMLDialogElement>('#preview'),
    'Missing preview.'
  );
  const previewArt = requireValue(document.querySelector('#preview-art'), 'Missing preview art.');
  const previewSource = requireValue(
    document.querySelector('#preview-source'),
    'Missing preview source.'
  );
  const previewTitle = requireValue(
    document.querySelector('#preview-title'),
    'Missing preview title.'
  );
  const previewName = requireValue(
    document.querySelector<HTMLInputElement>('#preview-name'),
    'Missing preview name.'
  );
  const previewTags = requireValue(
    document.querySelector('#preview-tags'),
    'Missing preview tags.'
  );
  const copy = requireValue(
    document.querySelector<HTMLButtonElement>('#copy'),
    'Missing copy button.'
  );
  const copyMessage = requireValue(document.querySelector('#copy-message'), 'Missing copy status.');

  const composeAdd = requireValue(
    document.querySelector<HTMLButtonElement>('#compose-add'),
    'Missing composer button.'
  );

  const add = requireValue(
    document.querySelector<HTMLButtonElement>('#add'),
    'Missing add button.'
  );
  const remove = requireValue(
    document.querySelector<HTMLButtonElement>('#remove'),
    'Missing remove button.'
  );
  const openSevenTV = requireValue(
    document.querySelector<HTMLAnchorElement>('#open-7tv'),
    'Missing 7TV link.'
  );
  let selected: BrowserEmote | undefined;
  let pendingArt: HTMLImageElement | undefined;

  /**
   * Clears the art at once and shows the largest image after it loads, so neither the previous
   * emote nor a smaller stand-in appears while it downloads. A load that finishes after another
   * emote was opened is discarded.
   */
  function showArt(emote: BrowserEmote): void {
    const image = document.createElement('img');
    image.alt = '';
    pendingArt = image;
    previewArt.replaceChildren();
    function reveal(): void {
      if (pendingArt === image) previewArt.replaceChildren(image);
    }
    image.addEventListener('load', reveal, { once: true });
    image.addEventListener('error', reveal, { once: true });
    image.src = emote.preview ?? emote.image;
    if (image.complete) reveal();
  }

  function isSelected(emote: BrowserEmote | undefined): boolean {
    return (
      selected === emote
      || (emote?.sevenTVId !== undefined && selected?.sevenTVId === emote.sevenTVId)
    );
  }

  function syncActions(emote: BrowserEmote): void {
    selected = emote;
    composeAdd.hidden = emote.composeToken === undefined;
    composeAdd.disabled = options.composer.full();
    add.hidden = !options.canChange(emote, false);
    remove.hidden = !options.canChange(emote, true);
    previewSource.textContent = emote.added === true ? `${emote.source} · Added` : emote.source;
  }

  function showPreview(emote: BrowserEmote): void {
    syncActions(emote);
    add.disabled = options.isBusy();
    remove.disabled = options.isBusy();
    openSevenTV.hidden = !options.linkSevenTV || emote.sevenTVId === undefined;
    if (emote.sevenTVId !== undefined)
      openSevenTV.href = `https://7tv.app/emotes/${emote.sevenTVId}`;
    showArt(emote);
    previewTitle.textContent = emote.name;
    previewTags.replaceChildren(
      ...emoteTags(emote).map((tag) => {
        const item = document.createElement('li');
        item.textContent = tag;
        return item;
      })
    );
    previewName.value = emote.name;
    copyMessage.textContent =
      emote.composeToken !== undefined && composeAdd.disabled ?
        'The composer is full. Remove an input to add more.'
      : '';
    preview.showModal();
  }

  async function copyName(): Promise<void> {
    try {
      await navigator.clipboard.writeText(previewName.value);
      copyMessage.textContent = 'Copied.';
    } catch {
      previewName.focus();
      previewName.select();
      copyMessage.textContent = 'Name selected. Use your device’s copy command.';
    }
  }

  const { openExternal } = options;
  if (openExternal !== undefined) {
    openSevenTV.addEventListener('click', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
      event.preventDefault();
      void openExternal(openSevenTV.href).catch(() => {
        copyMessage.textContent = 'Could not open 7TV.';
      });
    });
  }
  composeAdd.addEventListener('click', () => {
    if (selected === undefined) return;
    options.composer.add(selected);
    options.onCompose();
    preview.close();
  });
  copy.addEventListener('click', () => {
    void copyName();
  });

  // Backdrop clicks target the dialog itself. Close only when both the press and the release land
  // outside its box, so clicks on the padding or a text selection dragged outward keep it open.
  type Pointer = Readonly<{ target: unknown; clientX: number; clientY: number }>;
  function outside(event: Pointer): boolean {
    if (event.target !== preview) return false;
    const box = preview.getBoundingClientRect();
    return (
      event.clientX < box.left
      || event.clientX > box.right
      || event.clientY < box.top
      || event.clientY > box.bottom
    );
  }
  if (!Reflect.has(preview, 'closedBy')) {
    let pressedOutside = false;
    preview.addEventListener('pointerdown', (event: Pointer) => {
      pressedOutside = outside(event);
    });
    preview.addEventListener('click', (event: Pointer) => {
      if (pressedOutside && outside(event)) preview.close();
      pressedOutside = false;
    });
  }

  return {
    connectChanges(changeEmote): void {
      function changePreviewEmote(removing: boolean): void {
        const emote = selected;
        void changeEmote(emote, removing, (feedback) => {
          if (isSelected(emote)) copyMessage.textContent = feedback;
        });
      }
      add.addEventListener('click', () => {
        changePreviewEmote(false);
      });
      remove.addEventListener('click', () => {
        changePreviewEmote(true);
      });
    },
    show: showPreview,
    refreshActions(emote): void {
      if (!isSelected(emote)) return;
      syncActions(emote);
    },
    setBusy(busy): void {
      add.disabled = busy;
      remove.disabled = busy;
    }
  };
}
