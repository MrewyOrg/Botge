import type { Media } from '../../types.ts';
import { checked, isArrayOf, isRecord } from '../../utils/validation.ts';
import { requestJson } from '../http.ts';

type TenorPosts = {
  readonly results: readonly {
    readonly id: string;
    readonly media_formats: { readonly tinygif?: { readonly url: string } };
  }[];
};

function isPosts(value: unknown): value is TenorPosts {
  return (
    isRecord(value)
    && isArrayOf(value['results'], (post): post is TenorPosts['results'][number] => {
      if (!isRecord(post) || typeof post['id'] !== 'string' || !isRecord(post['media_formats']))
        return false;
      const preview = post['media_formats']['tinygif'];
      return preview === undefined || (isRecord(preview) && typeof preview['url'] === 'string');
    })
  );
}

function tenorId(url: string): string | undefined {
  return /^https:\/\/tenor\.com\/view\/[^?#]*-(?<id>\d+)\/?(?:[?#].*)?$/u.exec(url)?.groups?.['id'];
}

/** Match results by ID: missing or reordered results must not shift another item's preview. */
export async function resolveTenorMedia(
  media: readonly Media[],
  apiKey: string | undefined = process.env['TENOR_API_KEY']
): Promise<readonly Media[]> {
  if (apiKey === undefined || apiKey.trim() === '') return media;
  const ids = [
    ...new Set(media.map((entry) => tenorId(entry.url)).filter((id) => id !== undefined))
  ];
  const previews = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const params = new URLSearchParams({
      key: apiKey,
      ids: ids.slice(offset, offset + 50).join(','),
      media_filter: 'tinygif'
    });
    const response = checked(
      await requestJson(`https://tenor.googleapis.com/v2/posts?${params.toString()}`),
      isPosts,
      'Tenor posts'
    );
    for (const post of response.results) {
      const url = post.media_formats.tinygif?.url;
      if (url !== undefined) previews.set(post.id, url);
    }
  }
  return media.map((entry) => {
    const id = tenorId(entry.url);
    const url = id === undefined ? undefined : previews.get(id);
    return url === undefined ? entry : { ...entry, tenorUrl: url };
  });
}
