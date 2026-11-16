/* Adds the demo notice to the catalog page; only demo builds load this module. */

import { requireValue } from '../validation.ts';

/**
 * Inserts the notice explaining the placeholder emotes below the catalog introduction.
 *
 * @remarks
 * The markup lives here rather than in `index.html`, so production pages never contain it.
 *
 * @throws `Error` if the catalog introduction is missing.
 */
export function mountDemoNotice(): void {
  const intro = requireValue(document.querySelector('#catalog-intro'), 'Missing catalog intro.');
  const notice = document.createElement('aside');
  notice.id = 'demo-notice';
  notice.className = 'demo-notice';
  notice.setAttribute('aria-label', 'Demo notice');
  const title = document.createElement('strong');
  title.textContent = 'Demo emotes';
  const text = document.createElement('p');
  text.textContent =
    "These are placeholder emotes for trying the features. In the live Activity inside Discord, you'll"
    + " see your server's emotes and real 7TV emotes here. This is an unofficial preview, not"
    + ' affiliated with Discord or 7TV.';
  notice.append(title, text);
  intro.after(notice);
}
