/* Tracks the guild's saved 7TV emotes, the caller's permissions, and in-flight server changes. */

import type { BrowserEmote } from './catalog.ts';

/** Permissions reported with a server catalog. Both default to `false`. */
type CatalogPermissions = Readonly<{ canManageEmotes?: boolean; canComposeDiscovery?: boolean }>;

/**
 * Creates the shared emote access state that previews, selection, tiles, and server actions read.
 *
 * @remarks
 * The state has no DOM dependencies, so every catalog module can share it without referring to one
 * another. Only one server change runs at a time.
 *
 * @param allowAdds - Whether this build may add 7TV emotes to the guild.
 * @returns Readers for saved emotes and permissions, plus the busy flag for server changes.
 */
export function createEmoteAccess(allowAdds: boolean): {
  /**
   * Replaces the saved emotes and permissions from a newly loaded catalog.
   * @param entries - Catalog entries, including saved 7TV additions.
   * @param permissions - Permissions reported by the server; omitted for the local catalog.
   */
  readonly setCatalog: (entries: readonly BrowserEmote[], permissions?: CatalogPermissions) => void;
  /**
   * Finds the guild's entry for a 7TV emote.
   * @param id - A 7TV emote ID.
   * @returns The saved or feed entry, or `undefined` when the guild does not have it.
   */
  readonly known: (id: string) => BrowserEmote | undefined;
  /**
   * Reports whether the caller may add or remove an emote on the server.
   * @param emote - Catalog or discovery entry.
   * @param removing - `true` to check removal, `false` to check adding.
   */
  readonly canChange: (emote: BrowserEmote, removing: boolean) => boolean;
  /** Reports whether discovery emotes may be composed by 7TV ID. */
  readonly canComposeDiscovery: () => boolean;
  /**
   * Applies a successful server change to the shared saved-emote state immediately.
   * @param emote - The emote that was added or removed.
   * @param removing - `true` when the emote was removed, `false` when it was added.
   * @returns The emote with its updated server and composer state.
   */
  readonly setChanged: (emote: BrowserEmote, removing: boolean) => BrowserEmote;
  /** Reports whether a server change is in flight. */
  readonly isBusy: () => boolean;
  /**
   * Marks a server change as started or finished.
   * @param busy - `true` while a change is in flight.
   */
  readonly setBusy: (busy: boolean) => void;
} {
  let known = new Map<string, BrowserEmote>();
  let manage = false;
  let composeDiscovery = false;
  let busy = false;

  return {
    setCatalog(entries, permissions = {}): void {
      manage = permissions.canManageEmotes === true;
      composeDiscovery = permissions.canComposeDiscovery === true;
      known = new Map();
      // If an ID occurs in both a feed and the added list, keep the entry the guild can remove.
      for (const emote of entries) {
        if (emote.sevenTVId !== undefined && (!known.has(emote.sevenTVId) || emote.added === true))
          known.set(emote.sevenTVId, emote);
      }
    },
    known: (id) => known.get(id),
    canChange(emote, removing): boolean {
      if (!manage || emote.sevenTVId === undefined) return false;
      const saved = known.get(emote.sevenTVId);
      return removing ? saved?.added === true : allowAdds && saved === undefined;
    },
    canComposeDiscovery: () => composeDiscovery,
    setChanged(emote, removing): BrowserEmote {
      if (emote.sevenTVId === undefined) return emote;
      if (removing) {
        known.delete(emote.sevenTVId);
        const removed: { -readonly [K in keyof BrowserEmote]: BrowserEmote[K] } = {
          ...emote,
          added: false
        };
        if (composeDiscovery) removed.composeToken = `7tv:${emote.sevenTVId}`;
        else delete removed.composeToken;
        return removed;
      }
      const added: BrowserEmote = {
        ...emote,
        added: true,
        composeToken: emote.composeToken ?? emote.name
      };
      known.set(emote.sevenTVId, added);
      return added;
    },
    isBusy: () => busy,
    setBusy(value): void {
      busy = value;
    }
  };
}
