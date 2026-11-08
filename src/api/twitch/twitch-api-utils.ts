import type { TwitchClip, TwitchClips } from '../../types.ts';
import type { TwitchApi } from './twitch-api.ts';

async function resolveClipGameNames(
  twitchApi: Readonly<TwitchApi>,
  twitchClips: TwitchClips
): Promise<TwitchClip[]> {
  const gameIds = new Set(twitchClips.data.map((clip) => clip.game_id).filter((id) => id !== ''));
  const games = gameIds.size > 0 ? await twitchApi.games(gameIds) : { data: [] };
  const names = new Map(games.data.map((game) => [game.id, game.name]));

  return twitchClips.data.map((twitchClip) => {
    const gameName = names.get(twitchClip.game_id);
    return { ...twitchClip, game_id: gameName ?? twitchClip.game_id };
  });
}

// max 100 ids
export async function getClipsWithGameNameFromIds(
  twitchApi: Readonly<TwitchApi>,
  ids: Readonly<Iterable<string>>
): Promise<TwitchClip[]> {
  const clips = await twitchApi.clipsFromIds(ids);

  return resolveClipGameNames(twitchApi, clips);
}

export async function getClipsWithGameNameFromBroadcasterName(
  twitchApi: Readonly<TwitchApi>,
  broadcasterName: string,
  cursor?: string
): Promise<readonly [TwitchClip[], string | undefined]> {
  const users = await twitchApi.users([broadcasterName]);
  const broadcasterId = users.data.at(0)?.id;
  if (broadcasterId === undefined) throw new Error('Twitch broadcaster not found.');

  const clips = await twitchApi.clipsFromBroadcasterId(broadcasterId, cursor);
  const clipsWithGameNames = await resolveClipGameNames(twitchApi, clips);

  return [clipsWithGameNames, clips.pagination.cursor];
}
