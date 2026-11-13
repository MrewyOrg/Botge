/* Fetches public 7TV discovery pages and accepts preview media only from the expected CDN. */

import type { DeepReadonly, MarkRequired } from 'ts-essentials';

import { type BrowserEmote, parseEmoteTags, tagTerms } from './catalog.ts';
import { isSevenTVEmoteId } from './seventv-id.ts';
import { isRecord } from '../validation.ts';

/** Public 7TV rankings supported by the discovery browser. */
export type DiscoveryMode = 'trending' | 'top';

const PAGE_SIZE = 24;
const SEARCH = `
  query Discover($query: String, $page: Int!, $perPage: Int!, $sort: Sort!, $filters: Filters, $tags: Tags) {
    emotes {
      search(query: $query, page: $page, perPage: $perPage, sort: $sort, filters: $filters, tags: $tags) {
        pageCount
        items {
          id
          defaultName
          tags
          flags { animated nsfw private publicListed defaultZeroWidth }
          images { url }
        }
      }
    }
  }
`;

function previewPath(images: readonly unknown[], id: string): string | undefined {
  for (const size of ['2x', '1x', '3x', '4x']) {
    for (const format of ['webp', 'avif', 'png', 'gif']) {
      const path = `/emote/${id}/${size}.${format}`;
      if (images.some((image) => isRecord(image) && image['url'] === `https://cdn.7tv.app${path}`))
        return path;
    }
  }
  return undefined;
}

/**
 * Validates a discovery page and discards unsafe or malformed emote entries.
 *
 * @remarks
 * Entries must be public, listed, non-private, and non-NSFW. Preview URLs must match the
 * expected 7TV CDN path. Invalid page metadata rejects the page rather than hiding a failure.
 *
 * @param data - Untrusted GraphQL JSON response.
 * @param embedded - Rewrites accepted previews to the Activity's CDN mapping when true.
 * @returns Accepted emotes and the provider's page count.
 * @throws `Error` if GraphQL reports errors or the page structure is invalid.
 */
export function parseDiscoveryPage(
  data: unknown,
  embedded: boolean
): DeepReadonly<{ emotes: readonly MarkRequired<BrowserEmote, 'sevenTVId'>[]; pageCount: number }> {
  const root = isRecord(data) && !Object.hasOwn(data, 'errors') ? data['data'] : undefined;
  const emotes = isRecord(root) ? root['emotes'] : undefined;
  const page = isRecord(emotes) ? emotes['search'] : undefined;
  const pageCount = isRecord(page) ? page['pageCount'] : undefined;
  if (
    !isRecord(page)
    || !Array.isArray(page['items'])
    || typeof pageCount !== 'number'
    || !Number.isSafeInteger(pageCount)
    || pageCount < 0
  )
    throw new Error('Invalid 7TV discovery response.');

  const entries = page['items'].flatMap((item: unknown) => {
    if (!isRecord(item)) return [];
    const { id, defaultName, flags, images, tags } = item;
    if (
      !isSevenTVEmoteId(id)
      || typeof defaultName !== 'string'
      || defaultName.trim() === ''
      || Array.from(defaultName).length > 80
      || /\p{Cc}/u.test(defaultName)
      || !isRecord(flags)
      || flags['nsfw'] !== false
      || flags['private'] !== false
      || flags['publicListed'] !== true
      || typeof flags['animated'] !== 'boolean'
      || !Array.isArray(images)
    )
      return [];

    const path = previewPath(images, id);
    if (path === undefined) return [];
    return [
      {
        name: defaultName,
        source: '7TV',
        image: (embedded ? '/7tv-cdn' : 'https://cdn.7tv.app') + path,
        animated: flags['animated'],
        sevenTVId: id,
        ...(typeof flags['defaultZeroWidth'] === 'boolean' ?
          { overlaying: flags['defaultZeroWidth'] }
        : {}),
        ...(Array.isArray(tags) ? { tags: parseEmoteTags(tags) } : {})
      }
    ];
  });

  return { emotes: entries, pageCount };
}

/**
 * Fetches one public discovery page within a 12-second HTTP deadline.
 *
 * @remarks
 * A caller abort cancels the request alongside the deadline. Embedded Activities use mapped
 * proxy routes; standalone previews contact the public 7TV endpoints.
 *
 * @param mode - Ranking to request.
 * @param page - One-based provider page number.
 * @param query - Name search text; surrounding whitespace is removed.
 * @param motion - Animated or static filter value, or an empty string.
 * @param embedded - Uses Activity URL mappings when true.
 * @param signal - Cancels a superseded discovery request.
 * @param overlay - Overlaying or regular filter value; defaults to no filter.
 * @param tags - Comma-separated tag terms; defaults to no tag filter.
 * @returns The validated page from {@link parseDiscoveryPage}.
 * @throws `Error` if the HTTP request or page validation fails.
 * @throws `DOMException` if the request is aborted or exceeds its deadline.
 */
export async function fetchDiscoveryPage(
  mode: DiscoveryMode,
  page: number,
  query: string,
  motion: string,
  embedded: boolean,
  signal: Readonly<AbortSignal>,
  overlay = '',
  tags = ''
): Promise<ReturnType<typeof parseDiscoveryPage>> {
  const terms = tagTerms(tags);
  // Discord's embedded browser reaches 7TV through the Activity URL mapping.
  const response = await fetch(embedded ? '/7tv-api/v4/gql' : 'https://7tv.io/v4/gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: SEARCH,
      variables: {
        query: query.trim(),
        page,
        perPage: PAGE_SIZE,
        sort: {
          sortBy: mode === 'trending' ? 'TRENDING_WEEKLY' : 'TOP_ALL_TIME',
          order: 'DESCENDING'
        },
        filters: {
          nsfw: false,
          animated: motion === '' ? undefined : motion === 'animated',
          defaultZeroWidth: overlay === '' ? undefined : overlay === 'overlaying'
        },
        tags: terms.length > 0 ? { match: 'ALL', tags: terms } : undefined
      }
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
  });
  if (!response.ok) throw new Error('7TV discovery request failed.');
  return parseDiscoveryPage((await response.json()) as unknown, embedded);
}
