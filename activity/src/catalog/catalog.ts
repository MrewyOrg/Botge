/* Validates catalog snapshots and applies local filters without changing catalog order. */

import type { DeepReadonly } from 'ts-essentials';

import { isComposeToken } from '../composer/compose-layout.ts';
import { isSevenTVEmoteId } from './seventv-id.ts';
import { isRecord } from '../validation.ts';

/**
 * Emote metadata accepted by catalog parsing or public discovery.
 *
 * @remarks
 * Entries are snapshots. Optional compose tokens and 7TV IDs enable the corresponding UI
 * actions; their absence does not make an emote invalid for browsing.
 *
 * @see {@link parseCatalog}
 */
export type BrowserEmote = DeepReadonly<{
  name: string;
  source: string;
  image: string;
  animated: boolean;
  added?: boolean;
  overlaying?: boolean;
  tags?: readonly string[];
  /** A single command-input token; absent when direct composition is unavailable. */
  composeToken?: string;
  sevenTVId?: string;
}>;

function isMappedImage(path: string): boolean {
  if (!/^\/(?:7tv|bttv|ffz|twitch)-cdn\/[^\\]+$/u.test(path)) return false;
  const url = URL.parse(path, 'https://activity.invalid');
  return url !== null && url.pathname + url.search === path;
}

/**
 * Normalizes provider tags without reordering their first occurrences.
 *
 * @param value - Untrusted tag values.
 * @returns Up to 32 distinct nonempty strings after trimming; other values are ignored.
 */
export function parseEmoteTags(value: readonly unknown[]): readonly string[] {
  return [
    ...new Set(
      value
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ].slice(0, 32);
}

/**
 * Validates a complete demo or server catalog before it reaches the UI.
 *
 * @remarks
 * Demo images must use local emote paths. Server images must use canonical mapped CDN paths.
 * Legacy zero-width metadata is accepted, while malformed entries reject the whole snapshot.
 *
 * @param input - Untrusted JSON catalog array.
 * @param server - Selects server validation and metadata; defaults to false for demo entries.
 * @returns Validated entries in their original order, with normalized labels and tags.
 * @throws `Error` if the catalog or any required entry field is invalid.
 * @see {@link BrowserEmote}
 */
export function parseCatalog(input: unknown, server = false): readonly BrowserEmote[] {
  if (!Array.isArray(input)) throw new Error('Expected an emote catalog array.');
  return input.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error('Expected an emote catalog entry.');
    const { name, source, image, animated, added, composeToken, sevenTVId, tags } = entry;
    // Accept older catalog snapshots that used the provider's zeroWidth name.
    const overlaying = entry['overlaying'] ?? entry['zeroWidth'];
    if (
      typeof name !== 'string'
      || name.trim() === ''
      || typeof source !== 'string'
      || source.trim() === ''
      || typeof image !== 'string'
      || !(server ?
        isMappedImage(image)
      : /^emotes\/(?:[\w-]+\/)*[\w-]+\.(?:png|webp|gif|jpe?g)$/iu.test(image))
      || typeof animated !== 'boolean'
      || (server && added !== undefined && typeof added !== 'boolean')
      || (server && sevenTVId !== undefined && (source !== '7TV' || !isSevenTVEmoteId(sevenTVId)))
      || (overlaying !== undefined && typeof overlaying !== 'boolean')
      || (server
        && composeToken !== undefined
        && (!isComposeToken(composeToken) || composeToken !== name))
    )
      throw new Error('Invalid emote catalog entry.');

    const token = server ? composeToken : name.trim();
    return {
      name: name.trim(),
      source: source.trim(),
      image,
      animated,
      ...(server && typeof added === 'boolean' ? { added } : {}),
      ...(server && typeof sevenTVId === 'string' ? { sevenTVId } : {}),
      ...(typeof overlaying === 'boolean' ? { overlaying } : {}),
      ...(Array.isArray(tags) ? { tags: parseEmoteTags(tags) } : {}),
      ...(isComposeToken(token) ? { composeToken: token } : {})
    };
  });
}

/**
 * Combines built-in labels with provider tags.
 *
 * @param emote - Validated catalog or discovery entry.
 * @returns Distinct provider, motion, overlay, added-state, and custom tags in display order.
 */
export function emoteTags(emote: BrowserEmote): readonly string[] {
  return [
    ...new Set([
      emote.source,
      emote.animated ? 'Animated' : 'Static',
      emote.overlaying === true ? 'Overlaying' : 'Regular',
      ...(emote.added === true ? ['Added'] : []),
      ...(emote.tags ?? [])
    ])
  ];
}

/**
 * Parses comma-separated tag search terms.
 *
 * @param value - User-entered tag filter.
 * @returns Up to 12 nonempty lowercase terms after trimming.
 */
export function tagTerms(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Applies catalog filters while preserving catalog order.
 *
 * @remarks
 * Name and tag matching ignore case. Each tag term must occur in at least one of the
 * emote's built-in or provider tags. Empty categorical filters accept all values.
 *
 * @param emotes - Validated catalog snapshot.
 * @param query - Name substring; surrounding whitespace is ignored.
 * @param source - Exact provider label, or an empty string for all providers.
 * @param motion - Animated or static filter value, or an empty string.
 * @param addedOnly - Requires an individually added emote when true; defaults to false.
 * @param overlay - Overlaying or regular filter value; defaults to no filter.
 * @param tags - Comma-separated tag substrings; defaults to no tag filter.
 * @returns Entries matching every active filter.
 *
 * @example
 * ```ts
 * filterEmotes(catalog, 'wave', '7TV', 'animated', false, 'overlaying', 'dance,greeting');
 * ```
 */
export function filterEmotes(
  emotes: readonly BrowserEmote[],
  query: string,
  source: string,
  motion: string,
  addedOnly = false,
  overlay = '',
  tags = ''
): readonly BrowserEmote[] {
  const search = query.trim().toLowerCase();
  const terms = tagTerms(tags);
  return emotes.filter(
    (emote) =>
      emote.name.toLowerCase().includes(search)
      && (source === '' || emote.source === source)
      && (motion === '' || emote.animated === (motion === 'animated'))
      && (!addedOnly || emote.added === true)
      && (overlay === '' || (emote.overlaying === true) === (overlay === 'overlaying'))
      && (terms.length === 0
        || terms.every((term) => emoteTags(emote).some((tag) => tag.toLowerCase().includes(term))))
  );
}
