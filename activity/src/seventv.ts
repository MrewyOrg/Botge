import type { BrowserEmote } from './catalog.ts';
import { isRecord } from './validation.ts';

export type DiscoveryMode = 'trending' | 'top';

const PAGE_SIZE = 24;
const SEARCH = `
  query Discover($query: String, $page: Int!, $perPage: Int!, $sort: Sort!, $filters: Filters) {
    emotes {
      search(query: $query, page: $page, perPage: $perPage, sort: $sort, filters: $filters) {
        pageCount
        items {
          id
          defaultName
          flags { animated nsfw private publicListed }
          images { url }
        }
      }
    }
  }
`;

function isSevenTVEmoteId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{24}|[a-z0-9]{26})$/iu.test(value);
}

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

export function parseDiscoveryPage(
  data: unknown,
  embedded: boolean
): Readonly<{ emotes: readonly BrowserEmote[]; pageCount: number }> {
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
    const { id, defaultName, flags, images } = item;
    if (
      !isSevenTVEmoteId(id)
      || typeof defaultName !== 'string'
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
        sevenTVId: id
      }
    ];
  });

  return { emotes: entries, pageCount };
}

export async function fetchDiscoveryPage(
  mode: DiscoveryMode,
  page: number,
  query: string,
  motion: string,
  embedded: boolean,
  signal: Readonly<AbortSignal>
): Promise<ReturnType<typeof parseDiscoveryPage>> {
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
        filters: { nsfw: false, animated: motion === '' ? undefined : motion === 'animated' }
      }
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)])
  });
  if (!response.ok) throw new Error('7TV discovery request failed.');
  return parseDiscoveryPage((await response.json()) as unknown, embedded);
}
