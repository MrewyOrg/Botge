import type { AssetInfo, Platform } from '../types.ts';
import { SEVEN_TV_EMOTES_URL } from './provider-urls.ts';

const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  sevenInSet: '7TV',
  sevenNotInSet: '7TV | Added Emote',
  bttv: 'BTTV',
  ffz: 'FFZ',
  twitch: 'Twitch'
};

export function platformStrings(): readonly string[] {
  return Object.values(PLATFORM_LABELS);
}
export function platformToString(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}
export function stringToPlatform(label: string): Platform | undefined {
  return Object.keys(PLATFORM_LABELS)
    .filter((platform): platform is Platform => Object.hasOwn(PLATFORM_LABELS, platform))
    .find((platform) => PLATFORM_LABELS[platform] === label);
}

const EMOTE_ENDPOINTS: ReadonlyMap<Platform, string> = new Map<Platform, string>([
  ['sevenInSet', 'https://7tv.app/emotes/'],
  ['sevenNotInSet', 'https://7tv.app/emotes/'],
  ['bttv', 'https://betterttv.com/emotes/'],
  ['ffz', 'https://www.frankerfacez.com/emoticon/']
]);

export function emotePageUrl(asset: AssetInfo): string {
  const { id, name, platform, url } = asset;
  if (platform === 'twitch') return url;

  const emoteEndpoint = EMOTE_ENDPOINTS.get(platform);
  if (emoteEndpoint === undefined) return url;

  const pageId = platform === 'ffz' ? `${id}-${encodeURIComponent(name)}` : id;
  return `${emoteEndpoint}${pageId}`;
}

export function addedEmoteApiUrl(asset: AssetInfo): string | undefined {
  const { id, platform } = asset;
  if (platform !== 'sevenNotInSet') return undefined;

  return `${SEVEN_TV_EMOTES_URL}/${id}`;
}
