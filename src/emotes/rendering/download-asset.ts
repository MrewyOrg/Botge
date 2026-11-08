import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { DeepReadonly } from 'ts-essentials';

import type { CachedUrl } from '../../api/cached-url.ts';
import { requestResponse } from '../../api/http.ts';
import type { AssetInfo, DownloadedAsset } from '../../types.ts';
import { DEFAULT_FRAME_COUNT, getDimension, getFrameCount } from './ffprobe-utils.ts';

const MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Stream with backpressure and enforce the limit on decoded response bytes, not just headers. */
async function saveAsset(response: DeepReadonly<Response>, filename: string): Promise<void> {
  const { body } = response;
  if (body === null) throw new Error('The asset response has no body.');
  if (Number(response.headers.get('content-length')) > MAX_ASSET_BYTES) {
    await body.cancel();
    throw new Error('Emote assets must not exceed 25 MiB.');
  }
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Readonly<{ byteLength: number }>, _encoding, callback): void {
      bytes += chunk.byteLength;
      callback(
        bytes > MAX_ASSET_BYTES ? new Error('Emote assets must not exceed 25 MiB.') : null,
        chunk
      );
    }
  });
  try {
    await pipeline(Readable.fromWeb(body), limit, createWriteStream(filename));
  } catch (error) {
    await rm(filename, { force: true });
    throw error;
  }
}

export async function downloadAsset(
  outdir: string,
  asset: AssetInfo | string,
  i: number,
  cachedUrl: Readonly<CachedUrl>
): Promise<DownloadedAsset | undefined> {
  const info = typeof asset === 'string' ? undefined : asset;
  const url = typeof asset === 'string' ? asset : asset.url;
  const [cached, hit] = cachedUrl.get(url);
  let filename = cached;
  if (!hit) {
    const response = await requestResponse(url);
    const extension = extname(new URL(url).pathname);
    filename = join(outdir, `${i}${/^\.[a-z0-9]{1,5}$/iu.test(extension) ? extension : '.img'}`);
    await saveAsset(response, filename);
  }
  const [frameCount, dimensions] = await Promise.all([
    info?.animated === false ? DEFAULT_FRAME_COUNT : (info?.frameCount ?? getFrameCount(filename)),
    info?.width !== undefined && info.height !== undefined ?
      ([info.width, info.height] as const)
    : getDimension(filename)
  ]);
  if (frameCount === undefined || dimensions === undefined) return undefined;
  return {
    filename,
    width: dimensions[0],
    height: dimensions[1],
    frameCount,
    animated: frameCount !== DEFAULT_FRAME_COUNT
  };
}
