import { requireValue } from './validation.ts';

type MenuTrigger = Readonly<Pick<HTMLButtonElement, 'focus' | 'getBoundingClientRect'>>;

type MenuAction = Readonly<{ label: string; run: () => void }>;

/** Mounts the emote action menu and keeps focus with its trigger when dismissed by keyboard. */
export function createContextMenu(): Readonly<{
  open: (trigger: MenuTrigger, x: number, y: number, actions: readonly MenuAction[]) => void;
}> {
  const menu = requireValue(
    document.querySelector<HTMLElement>('#emote-context-menu'),
    'Missing emote context menu.'
  );
  let owner: MenuTrigger | undefined;

  function close(restoreFocus = false): void {
    if (restoreFocus) owner?.focus({ preventScroll: true });
    owner = undefined;
    menu.hidden = true;
  }

  document.addEventListener('pointerdown', (event: Readonly<{ target: unknown }>) => {
    if (event.target instanceof Node && !menu.contains(event.target)) close();
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

      const buttons = [...menu.querySelectorAll('button')];
      const active = document.activeElement;
      const index = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
      switch (event.key) {
        case 'ArrowDown':
          buttons[(index + 1) % buttons.length]?.focus();
          break;
        case 'ArrowUp':
          buttons[(index + buttons.length - 1) % buttons.length]?.focus();
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
    open(trigger, x, y, actions): void {
      owner = trigger;
      const buttons = actions.map(({ label, run }) => {
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
      const anchor = trigger.getBoundingClientRect();
      // Keyboard invocation has no pointer position, so anchor it to the tile.
      const pointer = x !== 0 || y !== 0;
      menu.style.left = `${Math.max(8, Math.min(pointer ? x : anchor.left, window.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(pointer ? y : anchor.bottom, window.innerHeight - menu.offsetHeight - 8))}px`;
      buttons.at(0)?.focus({ preventScroll: true });
    }
  };
}
