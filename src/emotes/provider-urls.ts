import { requestJson, requestResponse } from '../api/http.ts';
import type { TwitchApi } from '../api/twitch/twitch-api.ts';
import type { SevenTVEmoteNotInSet } from '../types.ts';
import { isRecord } from '../utils/validation.ts';
import { parseBTTVSet, parseFFZSet, parseSevenTVEmote, parseSevenTVSet } from './provider-data.ts';

export const SEVEN_TV_EMOTES_URL = 'https://7tv.io/v3/emotes';

export type ApiUrlMessage =
  | { readonly type: 'success'; readonly url: string; readonly ownerUsername?: string | undefined }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'feedback'; readonly message: string };

export function getSevenTvEmoteSetLinkFromSevenTvApiUrl(apiUrl: string): string {
  const id = new URL(apiUrl).pathname.replace(/\/+$/u, '').split('/').at(-1) ?? '';
  return `https://7tv.app/emote-sets/${id}`;
}

export async function getSevenTvApiUrlFromSevenTvEmoteSetLink(
  link: string
): Promise<ApiUrlMessage> {
  const id = /^https:\/\/7tv\.app\/emote-sets\/(?<id>[A-Fa-f0-9]{24}|[A-Za-z0-9]{26})\/?$/u.exec(
    link
  )?.groups?.['id'];
  if (id === undefined)
    return {
      type: 'error',
      message:
        'Invalid 7TV emote set link. Use https://7tv.app/emote-sets/ followed by a valid set ID.'
    };
  const url = `https://7tv.io/v3/emote-sets/${id}`;
  try {
    const set = parseSevenTVSet(await requestJson(url));
    if (set.error !== undefined) return { type: 'error', message: set.error };
    if (!Array.isArray(set.emotes)) throw new Error('Invalid 7TV emote set.');
    return { type: 'success', url, ownerUsername: set.owner?.username };
  } catch {
    return { type: 'error', message: 'Unable to get the 7TV emote set.' };
  }
}

export async function getBttvApiUrlFromBroadcasterName(
  name: string,
  twitchApi: Readonly<TwitchApi> | undefined
): Promise<ApiUrlMessage> {
  if (twitchApi === undefined)
    return {
      type: 'error',
      message: 'The bot is unable to get broadcaster name from Twitch at this time.'
    };
  try {
    const user = (await twitchApi.users([name])).data.at(0);
    if (user === undefined) return { type: 'error', message: 'No such broadcaster.' };
    const url = `https://api.betterttv.net/3/cached/users/twitch/${user.id}`;
    const response = await requestResponse(url, {}, [404]);
    if (response.status === 404) {
      await response.body?.cancel();
      return { type: 'feedback', message: 'Broadcaster does not have BTTV emotes.' };
    }
    const data: unknown = await response.json();
    if (isRecord(data) && typeof data['message'] === 'string')
      return { type: 'feedback', message: 'Broadcaster does not have BTTV emotes.' };
    const set = parseBTTVSet(data);
    if (set.message !== undefined)
      return { type: 'feedback', message: 'Broadcaster does not have BTTV emotes.' };
    return { type: 'success', url };
  } catch {
    return { type: 'error', message: 'Unable to get the BTTV emote set or broadcaster.' };
  }
}

export async function getFfzApiUrlFromBroadcasterName(name: string): Promise<ApiUrlMessage> {
  const url = `https://api.frankerfacez.com/v1/room/${encodeURIComponent(name.toLowerCase())}`;
  try {
    const response = await requestResponse(url, {}, [404]);
    if (response.status === 404) {
      await response.body?.cancel();
      return { type: 'feedback', message: 'Broadcaster does not have FFZ emotes.' };
    }
    const data: unknown = await response.json();
    if (isRecord(data) && data['error'] !== undefined)
      return { type: 'feedback', message: 'Broadcaster does not have FFZ emotes.' };
    const set = parseFFZSet(data);
    if (set.error !== undefined)
      return { type: 'feedback', message: 'Broadcaster does not have FFZ emotes.' };
    return { type: 'success', url };
  } catch {
    return { type: 'error', message: 'Unable to get the FFZ emote set.' };
  }
}

export async function sevenTVUrlToSevenTVNotInSet(
  url: string
): Promise<SevenTVEmoteNotInSet | undefined> {
  const id = /^https:\/\/(?:old\.)?7tv\.app\/emotes\/(?<id>[A-Za-z0-9]+)\/?$/u.exec(url)?.groups?.[
    'id'
  ];
  if (id === undefined) return undefined;
  const emote = parseSevenTVEmote(
    await requestJson(`${SEVEN_TV_EMOTES_URL}/${id}`, { timeoutMs: 10_000 })
  );
  if (emote.error !== undefined) throw new Error(emote.error);
  return emote;
}
