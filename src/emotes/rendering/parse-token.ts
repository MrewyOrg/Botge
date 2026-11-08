import type { Twemoji } from '@twemoji/api';

import type { AssetInfo } from '../../types.ts';
import { isRecord } from '../../utils/validation.ts';
import { sevenTVNotInSetToAsset } from '../emote-to-asset.ts';
import { type EmoteProviderSettings, isEmoteUrlEnabled } from '../provider-policy.ts';
import { sevenTVUrlToSevenTVNotInSet } from '../provider-urls.ts';
import { maxPlatformSize } from './size-change.ts';

type EmojiParser = Readonly<Pick<Twemoji, 'base' | 'parse'>>;

function isEmojiParser(value: unknown): value is EmojiParser {
  return (
    isRecord(value) && typeof value['base'] === 'string' && typeof value['parse'] === 'function'
  );
}

const twemoji: EmojiParser = await (async (): Promise<EmojiParser> => {
  const value: unknown = (await import('@twemoji/api')).default;
  if (!isEmojiParser(value)) throw new Error('Invalid Twemoji module.');
  return value;
})();

const letterToId: ReadonlyMap<string, string> = new Map([
  ['A', '1f1e6'],
  ['B', '1f1e7'],
  ['C', '1f1e8'],
  ['D', '1f1e9'],
  ['E', '1f1ea'],
  ['F', '1f1eb'],
  ['G', '1f1ec'],
  ['H', '1f1ed'],
  ['I', '1f1ee'],
  ['J', '1f1ef'],
  ['K', '1f1f0'],
  ['L', '1f1f1'],
  ['M', '1f1f2'],
  ['N', '1f1f3'],
  ['O', '1f1f4'],
  ['P', '1f1f5'],
  ['Q', '1f1f6'],
  ['R', '1f1f7'],
  ['S', '1f1f8'],
  ['T', '1f1f9'],
  ['U', '1f1fa'],
  ['V', '1f1fb'],
  ['W', '1f1fc'],
  ['X', '1f1fd'],
  ['Y', '1f1fe'],
  ['Z', '1f1ff'],
  ['0', '30-20e3'],
  ['1', '31-20e3'],
  ['2', '32-20e3'],
  ['3', '33-20e3'],
  ['4', '34-20e3'],
  ['5', '35-20e3'],
  ['6', '36-20e3'],
  ['7', '37-20e3'],
  ['8', '38-20e3'],
  ['9', '39-20e3']
]);

function parseSingleLetterOrNumber(token: string): string | undefined {
  const emojiId = letterToId.get(token);
  if (emojiId === undefined) return undefined;

  return twemoji.base + '72x72' + '/' + emojiId + '.png';
}

function parseEmoji(emoji: string): string | undefined {
  const urls: string[] = [];
  twemoji.parse(emoji, (icon) => {
    const url = `${twemoji.base}72x72/${icon}.png`;
    urls.push(url);
    return url;
  });
  return urls.at(0);
}

export async function parseToken(
  url: string,
  highestSize: boolean,
  providers: EmoteProviderSettings
): Promise<AssetInfo | string | undefined> {
  if (!isEmoteUrlEnabled(url, providers))
    throw new Error('This emote provider is disabled by the operator.');
  const sourceEmote = await sevenTVUrlToSevenTVNotInSet(url);
  const asset =
    sourceEmote !== undefined ?
      highestSize ? sevenTVNotInSetToAsset(sourceEmote, maxPlatformSize('sevenNotInSet'))
      : sevenTVNotInSetToAsset(sourceEmote)
    : undefined;

  if (asset !== undefined) return asset;

  if (URL.canParse(url)) {
    if (url.startsWith('https://tenor.com/view/') && !url.endsWith('.gif')) return url + '.gif';
    else return url;
  }
  return parseEmoji(url) ?? parseSingleLetterOrNumber(url.toUpperCase());
}
