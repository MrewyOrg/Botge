/* Owns emote action menu positioning, keyboard navigation, and focus restoration. */

import { requireValue } from './validation.ts';

type MenuAction = { readonly label: string; readonly run: () => void };

/** Tile control that anchors a menu and receives its focus back. */
export type MenuTrigger = Readonly<
  Pick<
    HTMLButtonElement,
    'focus' | 'getBoundingClientRect' | 'hasAttribute' | 'setAttribute' | 'contains'
  >
>;

/**
 * Mounts the emote action menu and its keyboard and dismissal handlers.
 *
 * @remarks
 * Escape and Tab restore focus to the trigger. Pointer dismissal, scrolling, and resizing
 * close the menu without moving focus. Choosing an action closes the menu before running it.
 *
 * @returns A controller that replaces the menu's actions whenever it opens.
 * @throws `Error` if the required menu markup is missing.
 */
export function createContextMenu(): {
  /**
   * Opens the action menu. Keyboard invocation focuses the first action; pointer invocation
   * focuses the menu itself, so no action looks preselected and arrow keys still navigate.
   *
   * @param trigger - Tile that owns the menu and receives restored keyboard focus.
   * @param x - Pointer coordinate in the viewport; two zero coordinates select keyboard anchoring.
   * @param y - Pointer coordinate in the viewport; keyboard anchoring uses the tile's bottom edge.
   * @param actions - Ordered labels and callbacks for the current emote.
   * @param focusLast - Starts on the last item when opened with Up Arrow.
   */
  readonly open: (
    trigger: MenuTrigger,
    x: number,
    y: number,
    actions: readonly MenuAction[],
    focusLast?: boolean
  ) => void;
  /** Closes the menu and returns focus to its trigger. */
  readonly dismiss: () => void;
} {
  const menu = requireValue(
    document.querySelector<HTMLElement>('#emote-context-menu'),
    'Missing emote context menu.'
  );
  // Focusable only by script, so a pointer-opened menu can take focus without selecting an action.
  menu.tabIndex = -1;
  const native = typeof menu.showPopover === 'function';
  if (native) menu.popover = 'auto';
  let owner: MenuTrigger | undefined;

  function clearOwner(): void {
    if (owner?.hasAttribute('aria-haspopup') === true) owner.setAttribute('aria-expanded', 'false');
    owner = undefined;
  }

  function close(restoreFocus = false): void {
    const trigger = owner;
    clearOwner();
    if (native && menu.matches(':popover-open')) menu.hidePopover();
    menu.hidden = true;
    if (restoreFocus) trigger?.focus({ preventScroll: true });
  }

  if (native)
    menu.addEventListener('toggle', () => {
      if (!menu.matches(':popover-open')) close();
    });
  else
    document.addEventListener('pointerdown', (event: { readonly target: unknown }) => {
      if (
        event.target instanceof Node
        && !menu.contains(event.target)
        && !(owner?.hasAttribute('aria-haspopup') === true && owner.contains(event.target))
      )
        close();
    });
  window.addEventListener('resize', () => {
    close();
  });
  window.addEventListener(
    'scroll',
    () => {
      close();
    },
    { capture: true }
  );

  menu.addEventListener(
    'keydown',
    (event: Readonly<Pick<KeyboardEvent, 'key' | 'preventDefault'>>) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') event.preventDefault();
        close(true);
        return;
      }

      const buttons: readonly HTMLButtonElement[] = [...menu.querySelectorAll('button')];
      const active = document.activeElement;
      const index = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
      switch (event.key) {
        case 'ArrowDown':
          buttons[(index + 1) % buttons.length]?.focus();
          break;
        case 'ArrowUp':
          buttons.at(index < 0 ? -1 : index - 1)?.focus();
          break;
        case 'Home':
          buttons.at(0)?.focus();
          break;
        case 'End':
          buttons.at(-1)?.focus();
          break;
        default:
          return;
      }
      event.preventDefault();
    }
  );

  return {
    dismiss: (): void => {
      close(true);
    },
    open(trigger, x, y, actions, focusLast = false): void {
      close();
      owner = trigger;
      if (trigger.hasAttribute('aria-haspopup')) trigger.setAttribute('aria-expanded', 'true');
      const buttons: readonly HTMLButtonElement[] = actions.map(({ label, run }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.addEventListener('click', () => {
          close(true);
          run();
        });
        return button;
      });
      menu.replaceChildren(...buttons);
      menu.hidden = false;
      if (native)
        menu.showPopover(trigger instanceof HTMLElement ? { source: trigger } : undefined);
      const anchor = trigger.getBoundingClientRect();
      // Keyboard invocation has no pointer position, so anchor it to the tile.
      const pointer = x !== 0 || y !== 0;
      menu.style.left = `${Math.max(8, Math.min(pointer ? x : anchor.left, window.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(pointer ? y : anchor.bottom, window.innerHeight - menu.offsetHeight - 8))}px`;
      (pointer ? menu : buttons.at(focusLast ? -1 : 0))?.focus({ preventScroll: true });
    }
  };
}
