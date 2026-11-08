import type {
  AssetInfo,
  BTTVEmote,
  FFZEmote,
  SevenTVEmoteFile,
  SevenTVEmoteInSet,
  SevenTVEmoteNotInSet,
  TwitchEmote
} from '../types.ts';

const BTTV_CDN = 'cdn.betterttv.net/emote' as const;
const TWITCH_CDN = 'static-cdn.jtvnw.net/emoticons/v2' as const;

const EMOTE_SIZE = 2 as const;

function sevenTVFile(
  files: readonly SevenTVEmoteFile[],
  animated: boolean,
  size: number
): SevenTVEmoteFile {
  const preferred = `${size}x.${animated ? 'webp' : 'png'}`;
  const file =
    files.find((candidate) => candidate.name === preferred)
    ?? files.find((candidate) => candidate.name.startsWith(`${size}x.`))
    ?? files.find((candidate) => candidate.name.endsWith(animated ? '.webp' : '.png'))
    ?? files.at(0);
  if (file === undefined) throw new Error('7TV emote has no usable image files.');
  return file;
}

function cdnUrl(host: string, file: string): string {
  return `${host.startsWith('//') ? 'https:' : ''}${host}/${file}`;
}

export function sevenTVInSetToAsset(
  emote: SevenTVEmoteInSet,
  isSevenTVPersonal: boolean,
  size?: number
): AssetInfo {
  const { id, name, flags, data, timestamp } = emote;
  const { host, animated } = data;
  const file = sevenTVFile(host.files, animated, size ?? EMOTE_SIZE);
  return {
    id: id,
    name: name,
    url: cdnUrl(host.url, file.name),
    zeroWidth: !!(1 & flags),
    animated: animated,
    width: file.width,
    height: file.height,
    frameCount: file.frame_count,
    platform: 'sevenInSet',
    timestamp: timestamp,
    isSevenTVPersonal: isSevenTVPersonal
  };
}

export function sevenTVNotInSetToAsset(
  emote: Readonly<SevenTVEmoteNotInSet>,
  size?: number
): AssetInfo {
  const { id, name, flags, host, animated } = emote;
  const file = sevenTVFile(host.files, animated, size ?? EMOTE_SIZE);
  return {
    id: id,
    name: name,
    url: cdnUrl(host.url, file.name),
    zeroWidth: !!(256 & flags),
    animated: animated,
    width: file.width,
    height: file.height,
    frameCount: file.frame_count,
    platform: 'sevenNotInSet',
    timestamp: undefined,
    isSevenTVPersonal: false
  };
}

export function bttvToAsset(emote: BTTVEmote): AssetInfo {
  const { id, code, animated } = emote;
  const filename = `${EMOTE_SIZE}x.${animated ? 'webp' : 'png'}`;
  return {
    id: id,
    name: code,
    url: `https://${BTTV_CDN}/${id}/${filename}`,
    zeroWidth: false,
    animated: animated,
    width: undefined,
    height: undefined,
    frameCount: undefined,
    platform: 'bttv',
    timestamp: undefined,
    isSevenTVPersonal: false
  };
}

export function ffzToAsset(emote: FFZEmote): AssetInfo {
  const { id, name, urls } = emote;
  const url = urls[String(EMOTE_SIZE)] ?? urls['1'] ?? urls['4'];
  if (url === undefined) throw new Error('FFZ emote has no usable image URL.');
  return {
    id: String(id),
    name: name,
    url: new URL(url, 'https://cdn.frankerfacez.com').href,
    zeroWidth: false,
    animated: false,
    width: undefined,
    height: undefined,
    frameCount: undefined,
    platform: 'ffz',
    timestamp: undefined,
    isSevenTVPersonal: false
  };
}

export function twitchToAsset(emote: TwitchEmote): AssetInfo {
  const { id, name, format, theme_mode } = emote;
  const animated = format.includes('animated');
  const chosenFormat = animated ? 'animated' : 'static';
  const chosenThemeMode = theme_mode.includes('dark') ? 'dark' : 'light';
  return {
    id: id,
    name: name,
    url: `https://${TWITCH_CDN}/${id}/${chosenFormat}/${chosenThemeMode}/${EMOTE_SIZE}.0`,
    zeroWidth: false,
    animated: animated,
    width: undefined,
    height: undefined,
    frameCount: undefined,
    platform: 'twitch',
    timestamp: undefined,
    isSevenTVPersonal: false
  };
}
