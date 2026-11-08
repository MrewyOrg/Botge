import { requestJson } from '../../api/http.ts';
import type { AssetInfo, Platform } from '../../types.ts';
import { sevenTVNotInSetToAsset } from '../emote-to-asset.ts';
import { parseSevenTVEmote } from '../provider-data.ts';
import { SEVEN_TV_EMOTES_URL } from '../provider-urls.ts';

export function maxPlatformSize(platform: Platform): number {
  return platform === 'bttv' || platform === 'twitch' ? 3 : 4;
}

export function emoteSizeChange(url: string, size: number, platform: Platform): string {
  if (!Number.isInteger(size) || size < 1 || size > maxPlatformSize(platform)) return url;
  if (platform === 'sevenInSet' || platform === 'sevenNotInSet' || platform === 'bttv')
    return url.replace(/\/[1-4]x(?=\.)/u, `/${size}x`);
  if (platform === 'ffz') return size === 3 ? url : url.replace(/\/[124]$/u, `/${size}`);
  return url.replace(/\/[1-3]\.0$/u, `/${size}.0`);
}

export async function assetSizeChange(asset: AssetInfo, size: number): Promise<AssetInfo> {
  if (!Number.isInteger(size) || size < 1 || size > maxPlatformSize(asset.platform)) return asset;
  if (asset.platform === 'sevenInSet' || asset.platform === 'sevenNotInSet') {
    const emote = parseSevenTVEmote(await requestJson(`${SEVEN_TV_EMOTES_URL}/${asset.id}`));
    const resized = sevenTVNotInSetToAsset(emote, size);
    return {
      ...asset,
      url: resized.url,
      width: resized.width,
      height: resized.height,
      frameCount: resized.frameCount
    };
  }
  const url = emoteSizeChange(asset.url, size, asset.platform);
  return url === asset.url ?
      asset
    : { ...asset, url, width: undefined, height: undefined, frameCount: undefined };
}
