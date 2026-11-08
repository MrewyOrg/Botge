import { DATABASE_DIR } from '../../config/directory-paths.ts';
import type { TwitchClip, TwitchClips, TwitchEmote, TwitchGlobalEmotes } from '../../types.ts';
import { checked, isArrayOf, isRecord } from '../../utils/validation.ts';
import { BearerApi } from '../bearer-api.ts';
import { getTwitchAccessToken, TWITCH_API_ENDPOINTS } from './get-twitch-access-token.ts';

type TwitchGame = { readonly id: string; readonly name: string };
type TwitchGames = { readonly data: readonly TwitchGame[] };
type TwitchUser = { readonly id: string };
type TwitchUsers = { readonly data: readonly TwitchUser[] };

function isClip(value: unknown): value is TwitchClip {
  if (!isRecord(value)) return false;
  return (
    ['id', 'url', 'creator_name', 'game_id', 'title', 'created_at', 'thumbnail_url'].every(
      (key) => typeof value[key] === 'string'
    )
    && typeof value['view_count'] === 'number'
    && Number.isFinite(value['view_count'])
  );
}
function isClips(value: unknown): value is TwitchClips {
  return (
    isRecord(value)
    && isArrayOf(value['data'], isClip)
    && isRecord(value['pagination'])
    && (value['pagination']['cursor'] === undefined
      || typeof value['pagination']['cursor'] === 'string')
  );
}
function isGames(value: unknown): value is TwitchGames {
  return (
    isRecord(value)
    && isArrayOf(
      value['data'],
      (game): game is TwitchGame =>
        isRecord(game) && typeof game['id'] === 'string' && typeof game['name'] === 'string'
    )
  );
}
function isUsers(value: unknown): value is TwitchUsers {
  return (
    isRecord(value)
    && isArrayOf(
      value['data'],
      (user): user is TwitchUser => isRecord(user) && typeof user['id'] === 'string'
    )
  );
}
function isEmote(value: unknown): value is TwitchEmote {
  return (
    isRecord(value)
    && typeof value['id'] === 'string'
    && typeof value['name'] === 'string'
    && isArrayOf(value['format'], (format): format is string => typeof format === 'string')
    && isArrayOf(value['theme_mode'], (theme): theme is string => typeof theme === 'string')
  );
}
function isGlobalEmotes(value: unknown): value is TwitchGlobalEmotes {
  return isRecord(value) && isArrayOf(value['data'], isEmote);
}

export const TWITCH_ACCESS_TOKEN_PATH: 'data/twitchAccessToken.txt' = `${DATABASE_DIR}/twitchAccessToken.txt`;

export class TwitchApi extends BearerApi {
  public constructor(
    clientId: string,
    secret: string,
    accessToken: string,
    tokenPath: string = TWITCH_ACCESS_TOKEN_PATH
  ) {
    super(
      accessToken,
      tokenPath,
      async () => getTwitchAccessToken(clientId, secret),
      TWITCH_API_ENDPOINTS.accessTokenValidate,
      { 'Client-Id': clientId }
    );
  }

  public async clipsFromIds(ids: Readonly<Iterable<string>>): Promise<TwitchClips> {
    const values = [...ids];
    if (values.length === 0) return { data: [], pagination: {} };
    return checked(
      await this.#getMany(TWITCH_API_ENDPOINTS.clips, 'id', values),
      isClips,
      'Twitch clips'
    );
  }

  public async clipsFromBroadcasterId(
    broadcasterId: string,
    cursor?: string
  ): Promise<TwitchClips> {
    const params = new URLSearchParams({ broadcaster_id: broadcasterId, first: '100' });
    if (cursor !== undefined) params.set('after', cursor);
    return checked(
      await this.getJson(`${TWITCH_API_ENDPOINTS.clips}?${params.toString()}`),
      isClips,
      'Twitch clips'
    );
  }

  public async games(ids: Readonly<Iterable<string>>): Promise<TwitchGames> {
    const values = [...ids];
    if (values.length === 0) return { data: [] };
    return checked(
      await this.#getMany(TWITCH_API_ENDPOINTS.games, 'id', values),
      isGames,
      'Twitch games'
    );
  }

  public async users(logins: Readonly<Iterable<string>>): Promise<TwitchUsers> {
    const values = [...logins];
    if (values.length === 0) return { data: [] };
    return checked(
      await this.#getMany(TWITCH_API_ENDPOINTS.users, 'login', values),
      isUsers,
      'Twitch users'
    );
  }

  public async emotesGlobal(): Promise<TwitchGlobalEmotes> {
    return checked(
      await this.getJson(TWITCH_API_ENDPOINTS.emotesGlobal),
      isGlobalEmotes,
      'Twitch global emotes'
    );
  }

  async #getMany(endpoint: string, key: string, values: readonly string[]): Promise<unknown> {
    if (values.length > 100) throw new Error('Cannot request more than 100 items at once.');
    const params = new URLSearchParams();
    for (const value of values) params.append(key, value);
    return this.getJson(`${endpoint}?${params.toString()}`);
  }
}
