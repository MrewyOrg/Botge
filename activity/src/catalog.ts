import { isComposeToken } from './compose-layout.ts';
import { isSevenTVEmoteId } from './seventv-id.ts';
import { isRecord } from './validation.ts';

export type BrowserEmote = Readonly<{
  name: string;
  source: string;
  image: string;
  animated: boolean;
  added?: boolean;
  overlaying?: boolean;
  tags?: readonly string[];
  composeToken?: string;
  sevenTVId?: string;
}>;

function isMappedImage(path: string): boolean {
  if (!/^\/(?:7tv|bttv|ffz|twitch)-cdn\/[^\\]+$/u.test(path)) return false;
  const url = URL.parse(path, 'https://activity.invalid');
  return url !== null && url.pathname + url.search === path;
}

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

/** Validates bundled demo entries and server entries against their respective image paths. */
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

export function tagTerms(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Applies catalog filters. Every comma-separated tag term must match at least one tag. */
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
