import type { Index } from 'meilisearch';

import type { TwitchClip } from '../../types.ts';
import {
  getClipsWithGameNameFromBroadcasterName,
  getClipsWithGameNameFromIds
} from './twitch-api-utils.ts';
import type { TwitchApi } from './twitch-api.ts';

const CLIP_BATCH_SIZE = 100;
const MAX_CLIP_PAGES = 10;
const METADATA_PAGE_SIZE = 1000;

// Expose only the operations used by clip storage and search, without mutable SDK fields.
export type ClipIndex = Readonly<
  Pick<
    Index,
    'deleteAllDocuments' | 'getDocuments' | 'getPagination' | 'search' | 'updateDocuments'
  >
>;

type ClipMetadata = {
  readonly creatorNames: readonly string[];
  readonly gameIds: readonly string[];
};

/** Update batches sequentially so a rejected task is handled before fetching another page. */
export async function refreshClipIndex(
  index: ClipIndex,
  twitchApi: Readonly<TwitchApi>,
  broadcasterName: string,
  clipIds?: readonly string[],
  replace = false
): Promise<void> {
  let updated = 0;
  let needsClear = replace;
  const save = async (clips: readonly TwitchClip[]): Promise<void> => {
    if (needsClear) {
      needsClear = false;
      await index.deleteAllDocuments().waitTask();
    }
    if (clips.length === 0) return;
    await index
      .updateDocuments(clips.map((clip) => ({ ...clip, game_id: clip.game_id || 'N/A' })))
      .waitTask();
    updated += clips.length;
  };

  if (clipIds !== undefined) {
    // An empty curated list is still a successful replacement of the old index.
    if (clipIds.length === 0) await save([]);
    for (let offset = 0; offset < clipIds.length; offset += CLIP_BATCH_SIZE) {
      await save(
        await getClipsWithGameNameFromIds(
          twitchApi,
          clipIds.slice(offset, offset + CLIP_BATCH_SIZE)
        )
      );
    }
  } else {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_CLIP_PAGES; page++) {
      const [clips, nextCursor] = await getClipsWithGameNameFromBroadcasterName(
        twitchApi,
        broadcasterName,
        cursor
      );
      await save(clips);
      if (nextCursor === undefined || nextCursor === cursor) break;
      cursor = nextCursor;
    }
  }
  console.log(`Updated ${updated} clips.`);
}

/** Read every metadata page, independently of the search result limit. */
export async function getClipMetadata(index: ClipIndex): Promise<ClipMetadata> {
  const clips: Pick<TwitchClip, 'creator_name' | 'game_id' | 'created_at'>[] = [];
  let offset = 0;
  let total: number;
  do {
    const page = await index.getDocuments<
      Pick<TwitchClip, 'creator_name' | 'game_id' | 'created_at'>
    >({ offset, limit: METADATA_PAGE_SIZE, fields: ['creator_name', 'game_id', 'created_at'] });
    ({ total } = page);
    clips.push(...page.results);
    offset += page.results.length;
    if (page.results.length === 0) break;
  } while (offset < total);
  clips.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    creatorNames: [...new Set(clips.map((clip) => clip.creator_name))],
    gameIds: [...new Set(clips.map((clip) => clip.game_id))]
  };
}
