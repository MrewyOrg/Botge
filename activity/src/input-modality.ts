/* Records whether the last interaction was a pointer or the keyboard, for focus-ring styling. */

/**
 * Marks the document root with the most recent input method.
 *
 * @remarks
 * The page moves focus itself when dialogs and menus open and when it restores focus after an
 * action. Some browsers draw a focus ring for that even after a mouse click. The stylesheet hides
 * rings while `data-input` is `pointer`, so they appear only during keyboard use. Listeners run in
 * the capture phase, so the mode is set before any click or key handler moves focus. Before the
 * first interaction the attribute is absent and browsers keep their default behavior.
 */
export function trackInputModality(): void {
  const root = document.documentElement;
  document.addEventListener(
    'pointerdown',
    () => {
      root.dataset['input'] = 'pointer';
    },
    true
  );
  document.addEventListener(
    'keydown',
    () => {
      root.dataset['input'] = 'keyboard';
    },
    true
  );
}
