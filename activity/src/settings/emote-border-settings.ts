/* Edits the authenticated user’s border preference; an empty color disables the border. */

import { isRecord, requireValue } from '../validation.ts';

/**
 * Mounts the authenticated user's border preference form.
 *
 * @remarks
 * The first opening loads the saved preference. Failed saves leave previously loaded
 * controls editable. Disabling the border preserves the picker color for later reuse.
 *
 * @param request - Reads with no argument, saves a chosen color, or clears with an empty string.
 * @throws `Error` if required form markup is missing.
 */
export function mountEmoteBorderSettings(request: (color?: string) => Promise<unknown>): void {
  const panel = requireValue(
    document.querySelector<HTMLDetailsElement>('#emote-border-settings'),
    'Missing emote border settings.'
  );
  const form = requireValue(panel.querySelector('form'), 'Missing emote border form.');
  const fields = requireValue(form.querySelector('fieldset'), 'Missing emote border fields.');
  const enabled = requireValue(
    form.querySelector<HTMLInputElement>('input[name="enabled"]'),
    'Missing emote border toggle.'
  );
  const picker = requireValue(
    form.querySelector<HTMLInputElement>('input[type="color"]'),
    'Missing emote border color picker.'
  );
  const feedback = requireValue(panel.querySelector('[role="status"]'), 'Missing border feedback.');
  let loaded = false;

  async function update(color?: string): Promise<void> {
    if (panel.getAttribute('aria-busy') === 'true') return;
    panel.setAttribute('aria-busy', 'true');
    fields.disabled = true;
    feedback.textContent = color === undefined ? 'Loading emote border…' : 'Saving emote border…';
    try {
      const result = await request(color);
      if (!isRecord(result)) throw new Error('Invalid emote border response.');
      if (typeof result['message'] === 'string') throw new Error(result['message']);
      const saved = result['color'];
      if (typeof saved !== 'string' || (saved !== '' && !/^[a-f\d]{6}$/iu.test(saved)))
        throw new Error('Invalid emote border response.');
      enabled.checked = saved !== '';
      picker.disabled = !enabled.checked;
      if (enabled.checked) picker.value = `#${saved}`;
      loaded = true;
      feedback.textContent = color === undefined ? '' : 'Emote border saved.';
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : 'Could not load emote border.';
    } finally {
      fields.disabled = !loaded;
      panel.removeAttribute('aria-busy');
    }
  }

  panel.addEventListener('toggle', () => {
    if (panel.open && !loaded) void update();
  });
  enabled.addEventListener('change', () => {
    picker.disabled = !enabled.checked;
  });
  form.addEventListener('submit', (event: Readonly<Pick<Event, 'preventDefault'>>) => {
    event.preventDefault();
    if (loaded) void update(enabled.checked ? picker.value : '');
  });
  panel.hidden = false;
}
