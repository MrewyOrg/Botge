/** @format */

import { join, basename } from 'node:path';
import fetch from 'node-fetch';
import { writeFile } from 'node:fs/promises';

import type { CachedUrl } from '../../../../api/cached-url.ts';
import type { AssetInfo, DownloadedAsset } from '../../../../types.ts';
import { DEFAULT_FRAME_COUNT, getDimension, getFrameCount } from './ffprobe-utils.ts';

export async function downloadAsset(
  outdir: string,
  asset: AssetInfo | string,
  i: number,
  cachedUrl: Readonly<CachedUrl>
): Promise<DownloadedAsset | undefined> {
  if (typeof asset === 'object') {
    const { animated, width, height, url } = asset;

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

    let frameCount: Promise<number | undefined> | number | undefined;
    if (animated) {
      const frameCount_ = asset.frameCount;

      if (frameCount_ !== undefined) frameCount = frameCount_;
      else frameCount = getFrameCount(filename);
    } else {
      frameCount = DEFAULT_FRAME_COUNT;
    }

    let widthAndHeight:
      Promise<readonly [number, number] | undefined> | readonly [number, number] | undefined =
      hasWidthAndHeight ? [width, height] : getDimension(filename);

    frameCount = await frameCount;
    widthAndHeight = await widthAndHeight;
    if (frameCount === undefined || widthAndHeight === undefined) return undefined;

    return {
      filename: filename,
      width: widthAndHeight[0],
      height: widthAndHeight[1],
      frameCount: frameCount,
      animated: frameCount !== DEFAULT_FRAME_COUNT
    };
  }

  const response = await fetch(asset);
  const buffer: Readonly<Buffer> = Buffer.from(await response.arrayBuffer());
  const format = asset.includes('png') ? 'png' : 'gif'; // ? webp?
  const filename = join(outdir, `${i}_${i}.${format}`);
  await writeFile(filename, buffer);

  const _getFrameCount_ = getFrameCount(filename);
  const _getDimension_ = getDimension(filename);

  const frameCount = await _getFrameCount_;
  const widthAndHeight = await _getDimension_;

  if (frameCount === undefined || widthAndHeight === undefined) return undefined;

  return {
    filename: filename,
    width: widthAndHeight[0],
    height: widthAndHeight[1],
    frameCount: frameCount,
    animated: frameCount !== DEFAULT_FRAME_COUNT
  };
}
