/* Owns emote preview state and keeps asynchronous feedback tied to the displayed emote. */

import { type BrowserEmote, emoteTags } from './catalog.ts';
import type { createComposer } from '../composer/composer.ts';
import { requireValue } from '../validation.ts';

/** Capabilities supplied by the catalog, keeping dialog state private. */
type PreviewOptions = {
  readonly composer: ReturnType<typeof createComposer>;
  readonly canChange: (emote: BrowserEmote, removing: boolean) => boolean;
  readonly isBusy: () => boolean;
  readonly onCompose: () => void;
  readonly openExternal: ((url: string) => Promise<unknown>) | undefined;
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
  const previewImage = document.createElement('img');
  previewImage.alt = '';
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

  function showPreview(emote: BrowserEmote): void {
    selected = emote;
    composeAdd.hidden = emote.composeToken === undefined;
    composeAdd.disabled = options.composer.full();
    add.hidden = !options.canChange(emote, false);
    add.disabled = options.isBusy();
    remove.hidden = !options.canChange(emote, true);
    remove.disabled = options.isBusy();
    openSevenTV.hidden = emote.sevenTVId === undefined;
    if (emote.sevenTVId !== undefined)
      openSevenTV.href = `https://7tv.app/emotes/${emote.sevenTVId}`;
    previewImage.src = emote.image;
    previewArt.append(previewImage);
    previewSource.textContent = emote.added === true ? `${emote.source} · Added` : emote.source;
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
      !composeAdd.hidden && composeAdd.disabled ?
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

  return {
    connectChanges(changeEmote): void {
      function changePreviewEmote(removing: boolean): void {
        const emote = selected;
        void changeEmote(emote, removing, (feedback) => {
          if (selected === emote) copyMessage.textContent = feedback;
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
      if (selected !== emote) return;
      add.hidden = !options.canChange(emote, false);
      remove.hidden = !options.canChange(emote, true);
    },
    setBusy(busy): void {
      add.disabled = busy;
      remove.disabled = busy;
    }
  };
}
