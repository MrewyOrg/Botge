/** @format */

import { join, basename } from 'node:path';
import fetch from 'node-fetch';
import { writeFile } from 'node:fs/promises';

import type { CachedUrl } from '../../../../api/cached-url.ts';
import type { AssetInfo, DownloadedAsset } from '../../../../types.ts';
import { DEFAULT_DURATION, DEFAULT_FPS, getDimension, getDuration } from './ffprobe-utils.ts';

export async function downloadAsset(
  outdir: string,
  asset: AssetInfo | string,
  i: number,
  cachedUrl: Readonly<CachedUrl>
): Promise<DownloadedAsset | undefined> {
  if (typeof asset === 'object') {
    const { animated, width, height, frameCount, url } = asset;

    const [localUrl, ok] = cachedUrl.get(url);
    let filename = localUrl;
    if (!ok) {
      console.log('url not cached: ' + url);
      const response = await fetch(url);
      const buffer: Readonly<Buffer> = Buffer.from(await response.arrayBuffer());
      filename = join(outdir, `${i}_${basename(url)}`);
      await writeFile(filename, buffer);
    }

    const hasWidthAndHeight = width !== undefined && height !== undefined;
    let duration: Promise<number | undefined> | number | undefined;
    if (animated) {
      if (frameCount !== undefined) duration = frameCount / DEFAULT_FPS;
      else duration = getDuration(filename);
    } else {
      duration = DEFAULT_DURATION;
    }

    let widthAndHeight:
      Promise<readonly [number, number] | undefined> | readonly [number, number] | undefined =
      hasWidthAndHeight ? [width, height] : getDimension(filename);

    duration = await duration;
    widthAndHeight = await widthAndHeight;
    if (duration === undefined || widthAndHeight === undefined) return undefined;

    return {
      filename: filename,
      width: widthAndHeight[0],
      height: widthAndHeight[1],
      duration: duration,
      animated: duration !== DEFAULT_DURATION
    };
  }

  const response = await fetch(asset);
  const buffer: Readonly<Buffer> = Buffer.from(await response.arrayBuffer());
  const format = asset.includes('png') ? 'png' : 'gif'; // ? webp?
  const filename = join(outdir, `${i}_${i}.${format}`);
  await writeFile(filename, buffer);

  const _getDuration_ = getDuration(filename);
  const _getDimension_ = getDimension(filename);

  const duration = await _getDuration_;
  const widthAndHeight = await _getDimension_;

  if (duration === undefined || widthAndHeight === undefined) return undefined;

  return {
    filename: filename,
    width: widthAndHeight[0],
    height: widthAndHeight[1],
    duration: duration,
    animated: duration !== DEFAULT_DURATION
  };
}
