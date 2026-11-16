/* Collapsible secondary catalog filters, an active-filter count, a reset action, and `/` to search. */

import { requireValue } from '../validation.ts';

/**
 * Connects the filter toggle, count badge, and clear action to the secondary filter fields.
 *
 * @remarks
 * Fields inside a hidden label, such as the platform filter in discovery modes, do not apply and
 * are not counted. Clearing resets only the secondary fields; the search box is left unchanged.
 * Pressing `/` outside text fields and dialogs focuses the search box.
 *
 * @returns Controls that recount active filters and connect the clear action.
 * @throws `Error` if required filter markup is missing.
 */
export function createFilterPanel(): {
  /** Recounts active filters and updates the badge and clear action. */
  readonly update: () => void;
  /**
   * Connects the clear action to a results refresh.
   * @param onClear - Runs after the fields are reset.
   */
  readonly connectClear: (onClear: () => void) => void;
} {
  const toggle = requireValue(
    document.querySelector<HTMLButtonElement>('#filters-toggle'),
    'Missing filters toggle.'
  );
  const panel = requireValue(
    document.querySelector<HTMLElement>('#advanced-filters'),
    'Missing advanced filters.'
  );
  const count = requireValue(
    document.querySelector<HTMLElement>('#filter-count'),
    'Missing filter count.'
  );
  const clear = requireValue(
    document.querySelector<HTMLButtonElement>('#clear-filters'),
    'Missing clear filters action.'
  );
  const search = requireValue(
    document.querySelector<HTMLInputElement>('#search'),
    'Missing search.'
  );
  const fields: readonly (HTMLInputElement | HTMLSelectElement)[] = [
    ...panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
  ];

  function update(): void {
    let active = 0;
    for (const field of fields)
      if (field.value.trim() !== '' && field.parentElement?.hidden !== true) active += 1;
    count.textContent = String(active);
    count.hidden = active === 0;
    clear.disabled = active === 0;
  }

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    panel.hidden = !open;
  });
  let onClear: () => void = () => undefined;
  clear.addEventListener('click', () => {
    for (const field of fields) field.value = '';
    update();
    onClear();
  });
  document.addEventListener(
    'keydown',
    (
      event: Readonly<{
        key: string;
        ctrlKey: boolean;
        metaKey: boolean;
        altKey: boolean;
        target: unknown;
        preventDefault: () => void;
      }>
    ) => {
      const { target } = event;
      if (
        event.key !== '/'
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || (target instanceof HTMLElement
          && target.closest('input, select, textarea, dialog') !== null)
      )
        return;
      event.preventDefault();
      search.focus();
    }
  );
  update();
  return {
    update,
    connectClear(handler: () => void): void {
      onClear = handler;
    }
  };
}
