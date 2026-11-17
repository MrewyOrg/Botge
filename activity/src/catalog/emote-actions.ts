/* Loads the guild's server catalog and applies single and bulk 7TV emote changes to it. */

import type { ActivityOperation } from '../activity-api.ts';
import { type BrowserEmote, parseCatalog } from './catalog.ts';
import type { createEmoteAccess } from './emote-access.ts';
import type { createEmotePreview } from './emote-preview.ts';
import type { createEmoteResults } from './emote-results.ts';
import type { createEmoteSelection } from './emote-selection.ts';
import { isRecord, requireValue } from '../validation.ts';

type ActionOptions = {
  /** Sends one Activity API operation. */
  readonly request: (...operation: ActivityOperation) => Promise<unknown>;
  /** The guild that changes target, or `undefined` when none is known. */
  readonly guildId: string | undefined;
  /** The guild whose server catalog is shown, or `undefined` for the local catalog. */
  readonly catalogGuildId: string | undefined;
  readonly access: Pick<
    ReturnType<typeof createEmoteAccess>,
    'setCatalog' | 'canChange' | 'isBusy' | 'setBusy'
  >;
  readonly results: Pick<ReturnType<typeof createEmoteResults>, 'mode' | 'setCatalog'>;
  readonly selection: Pick<
    ReturnType<typeof createEmoteSelection>,
    'entries' | 'refresh' | 'removeSucceeded'
  >;
  readonly preview: Pick<ReturnType<typeof createEmotePreview>, 'setBusy' | 'refreshActions'>;
  /** Shows a catalog status message. */
  readonly report: (feedback: string) => void;
  /** Called after every successful server catalog load. */
  readonly onCatalogLoaded?: () => void;
};

/**
 * Creates the server catalog loader and the add and remove actions.
 *
 * @remarks
 * One catalog load and one change run at a time. A load requested during another runs once
 * after it, so a change reported mid-load is not lost; repeated change requests while busy are
 * ignored. A successful change reloads the catalog so tiles, the preview, and selection show the
 * new state. Bulk changes keep failed emotes selected for a retry. The Try again button appears
 * only after a failed load.
 *
 * @param options - API access, target guilds, shared state, and the controls to update.
 * @returns Catalog loading, single changes, and bulk selection changes.
 * @throws `Error` if the Try again button is missing.
 */
export function createEmoteActions(options: ActionOptions): {
  /**
   * Reloads the server catalog; does nothing without a catalog guild.
   * @param quiet - Skips the loading message, for reloads the user did not ask for.
   */
  readonly refreshCatalog: (quiet?: boolean) => Promise<void>;
  /**
   * Adds or removes one emote and reports progress and the outcome.
   * @param emote - The emote to change; ignored when the change is not allowed.
   * @param removing - `true` to remove, `false` to add.
   * @param report - Shows progress and the outcome where the change started.
   */
  readonly change: (
    emote: BrowserEmote | undefined,
    removing: boolean,
    report: (feedback: string) => void
  ) => Promise<void>;
  /**
   * Adds or removes every selected emote that allows the change.
   * @param removing - `true` to remove, `false` to add.
   */
  readonly changeSelection: (removing: boolean) => Promise<void>;
} {
  const { request, guildId, catalogGuildId, access, results, selection, preview, report } = options;
  const retry = requireValue(
    document.querySelector<HTMLButtonElement>('#refresh-catalog'),
    'Missing catalog retry.'
  );
  // Sets, like the access busy flag, so the post-await resets are not stale reassignments.
  const loading = new Set<'catalog'>();
  const queued = new Set<'catalog'>();

  /** Reports catalog problems only while the catalog is on screen. */
  function reportCatalog(feedback: string): void {
    if (results.mode() === 'catalog') report(feedback);
  }

  async function refreshCatalog(quiet = false): Promise<void> {
    if (catalogGuildId === undefined) return;
    if (loading.has('catalog')) {
      queued.add('catalog');
      return;
    }
    loading.add('catalog');
    retry.disabled = true;
    if (!quiet) reportCatalog('Loading server emotes…');
    let loaded = false;
    try {
      const payload = await request('catalog', catalogGuildId);
      if (!isRecord(payload) || !Array.isArray(payload['emotes'])) {
        reportCatalog(
          isRecord(payload) && typeof payload['message'] === 'string' ?
            payload['message']
          : 'Could not load server emotes.'
        );
        return;
      }
      const entries = parseCatalog(payload['emotes'], true);
      access.setCatalog(entries, {
        canManageEmotes: payload['canManageEmotes'] === true,
        canComposeDiscovery: payload['canComposeDiscovery'] === true
      });
      results.setCatalog(entries);
      loaded = true;
    } catch {
      reportCatalog('Could not load server emotes.');
    } finally {
      loading.delete('catalog');
      retry.disabled = false;
      retry.hidden = loaded || results.mode() !== 'catalog';
      if (loaded) options.onCatalogLoaded?.();
      if (queued.delete('catalog')) void refreshCatalog(true);
    }
  }

  async function change(
    emote: BrowserEmote | undefined,
    removing: boolean,
    feedback: (text: string) => void
  ): Promise<void> {
    if (
      guildId === undefined
      || emote?.sevenTVId === undefined
      || access.isBusy()
      || !access.canChange(emote, removing)
    )
      return;

    access.setBusy(true);
    selection.refresh();
    preview.setBusy(true);
    feedback(removing ? 'Removing emote…' : 'Adding emote…');
    try {
      const payload = await request(removing ? 'emotes/remove' : 'emotes', guildId, {
        emoteId: emote.sevenTVId
      });
      if (!isRecord(payload) || typeof payload['message'] !== 'string')
        throw new Error('Invalid add response.');
      if (payload['removed'] === true || payload['added'] === true) {
        await refreshCatalog();
        preview.refreshActions(emote);
      }
      feedback(payload['message']);
    } catch {
      feedback(
        removing ?
          'Could not remove this emote. Try again.'
        : 'Could not add this emote. Try again or open it on 7TV.'
      );
    } finally {
      access.setBusy(false);
      selection.refresh();
      preview.setBusy(false);
    }
  }

  async function changeSelection(removing: boolean): Promise<void> {
    if (guildId === undefined || access.isBusy()) return;
    const ids: readonly string[] = [
      ...new Set(
        selection
          .entries()
          .flatMap((emote) =>
            emote.sevenTVId !== undefined && access.canChange(emote, removing) ?
              [emote.sevenTVId]
            : []
          )
      )
    ];
    if (ids.length === 0) return;
    access.setBusy(true);
    let outcome = '';
    selection.refresh(removing ? 'Removing selected emotes…' : 'Adding selected emotes…');
    try {
      const payload = await request('emotes/batch', guildId, {
        action: removing ? 'remove' : 'add',
        emoteIds: ids
      });
      if (isRecord(payload) && typeof payload['message'] === 'string')
        throw new Error(payload['message']);
      if (!Array.isArray(payload)) throw new Error('Invalid bulk emote response.');
      const succeeded = new Set<string>();
      let failure = '';
      const changes: readonly unknown[] = payload;
      for (const result of changes) {
        if (
          !isRecord(result)
          || typeof result['emoteId'] !== 'string'
          || !ids.includes(result['emoteId'])
        )
          continue;
        if (result['ok'] === true) succeeded.add(result['emoteId']);
        else if (failure === '' && typeof result['message'] === 'string')
          failure = result['message'];
      }
      // Keep failed items selected so the user can retry them without picking them again.
      selection.removeSucceeded([...succeeded]);
      if (succeeded.size > 0) await refreshCatalog();
      outcome =
        `${removing ? 'Removed' : 'Added'} ${succeeded.size} of ${ids.length}. ${failure}`.trim();
    } catch (error) {
      outcome = error instanceof Error ? error.message : 'Could not update selected emotes.';
    } finally {
      access.setBusy(false);
      selection.refresh(outcome);
    }
  }

  return { refreshCatalog, change, changeSelection };
}
