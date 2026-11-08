import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { CachedUrl } from 'src/api/cached-url.ts';
import {
  ffzToAsset,
  sevenTVInSetToAsset,
  sevenTVNotInSetToAsset,
  twitchToAsset
} from 'src/emotes/emote-to-asset.ts';
import { downloadAsset } from 'src/emotes/rendering/download-asset.ts';
import { getDimension, getFrameCount } from 'src/emotes/rendering/ffprobe-utils.ts';
import { assetSizeChange, emoteSizeChange } from 'src/emotes/rendering/size-change.ts';
import type { SevenTVEmoteNotInSet } from 'src/types.ts';

vi.mock('src/emotes/rendering/ffprobe-utils.ts', () => ({
  DEFAULT_FRAME_COUNT: 1,
  getDimension: vi.fn(),
  getFrameCount: vi.fn()
}));

const emote: SevenTVEmoteNotInSet = {
  id: 'id',
  name: 'Original',
  flags: 256,
  animated: false,
  host: {
    url: '//cdn.7tv.app/emote/id',
    files: [
      { name: '2x.png', width: 64, height: 32, frame_count: 1, format: 'PNG' },
      { name: '4x.png', width: 128, height: 64, frame_count: 1, format: 'PNG' }
    ]
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test('selects an existing 7TV image when the requested size is absent and rejects empty hosts', () => {
  expect(sevenTVNotInSetToAsset(emote, 3).url).toBe('https://cdn.7tv.app/emote/id/2x.png');
  expect(() => sevenTVNotInSetToAsset({ ...emote, host: { ...emote.host, files: [] } })).toThrow(
    'no usable image'
  );
  expect(
    ffzToAsset({ id: 1, name: 'FFZ', urls: { '1': '//cdn.frankerfacez.com/emote/1/1' } }).url
  ).toBe('https://cdn.frankerfacez.com/emote/1/1');
});

test('uses Twitch format names rather than relying on response array order', () => {
  expect(
    twitchToAsset({
      id: '1',
      name: 'Wave',
      format: ['animated', 'static'],
      theme_mode: ['dark', 'light']
    }).url
  ).toContain('/animated/dark/2.0');
  expect(
    twitchToAsset({ id: '1', name: 'Wave', format: ['animated'], theme_mode: ['light'] }).animated
  ).toBe(true);
});

test('resizing preserves the set alias, flags, timestamp, and personal status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(emote)));
  const original = sevenTVInSetToAsset(
    { id: emote.id, name: 'Alias', flags: 0, timestamp: 123, data: emote },
    true
  );
  const resized = await assetSizeChange(original, 4);
  expect(resized).toEqual({
    ...original,
    url: 'https://cdn.7tv.app/emote/id/4x.png',
    width: 128,
    height: 64
  });
});

test('resizes all providers, rejects fractional/unsupported sizes, and invalidates old dimensions', async () => {
  const original = {
    ...sevenTVNotInSetToAsset(emote),
    platform: 'bttv' as const,
    url: 'https://cdn.betterttv.net/emote/id/2x.png'
  };
  expect(await assetSizeChange(original, 3)).toMatchObject({
    url: 'https://cdn.betterttv.net/emote/id/3x.png',
    width: undefined,
    height: undefined
  });
  expect(await assetSizeChange(original, 4)).toBe(original);
  expect(emoteSizeChange('https://cdn/emote/1/1', 3, 'ffz')).toBe('https://cdn/emote/1/1');
  expect(emoteSizeChange(original.url, 1.5, 'bttv')).toBe(original.url);
});

test('download rejects HTTP errors and does not save the error page as an image', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 404 })));
  await expect(
    downloadAsset(tmpdir(), 'https://example.com/no.png', 1, new CachedUrl(undefined))
  ).rejects.toThrow('404');
});

test('download handles raw WebP URLs and avoids probing known static emote metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-emote-'));
  try {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('raw'))
      .mockResolvedValueOnce(new Response('known'));
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getFrameCount).mockResolvedValue(4);
    vi.mocked(getDimension).mockResolvedValue([64, 32]);
    const raw = await downloadAsset(
      directory,
      'https://example.com/image.webp?x=png',
      0,
      new CachedUrl(undefined)
    );
    expect(raw?.filename).toBe(join(directory, '0.webp'));
    expect(raw?.animated).toBe(true);
    const known = await downloadAsset(
      directory,
      sevenTVNotInSetToAsset(emote),
      1,
      new CachedUrl(undefined)
    );
    expect(known?.animated).toBe(false);
    expect(getDimension).toHaveBeenCalledTimes(1);
    expect(getFrameCount).toHaveBeenCalledTimes(1);
    expect(await readFile(join(directory, '1.png'), 'utf8')).toBe('known');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('asset selection handles static Twitch, animated 7TV and FFZ fallback sizes', () => {
  expect(
    twitchToAsset({ id: 'id', name: 'Static', format: ['static'], theme_mode: ['light'] }).animated
  ).toBe(false);
  expect(
    ffzToAsset({ id: 1, name: 'OnlyLarge', urls: { '4': 'https://example.com/large.png' } }).url
  ).toBe('https://example.com/large.png');
  expect(() => ffzToAsset({ id: 1, name: 'Empty', urls: {} })).toThrow('no usable image');
  expect(
    sevenTVNotInSetToAsset({
      ...emote,
      animated: true,
      host: {
        url: 'https://example.com',
        files: [{ name: '1x.webp', width: 32, height: 32, frame_count: 2, format: 'WEBP' }]
      }
    }).url
  ).toBe('https://example.com/1x.webp');
});

test.each(['header', 'stream', 'error', 'empty'])(
  'downloads bound response memory and clean partial files: %s',
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'botge-download-limit-'));
    const cancelled = vi.fn();
    let chunks = 0;
    const block = new Uint8Array(1024 * 1024);
    const response =
      kind === 'empty' ? new Response(null)
      : kind === 'header' ?
        new Response('too big', { headers: { 'Content-Length': String(26 * 1024 * 1024) } })
      : new Response(
          new ReadableStream<Uint8Array>({
            pull(
              controller: Readonly<
                Pick<ReadableStreamDefaultController<Uint8Array>, 'enqueue' | 'close' | 'error'>
              >
            ): void {
              if (kind === 'error') {
                controller.error(new Error('read failed'));
                return;
              }
              if (chunks++ === 30) controller.close();
              else controller.enqueue(block);
            },
            cancel: cancelled
          })
        );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    try {
      await expect(
        downloadAsset(directory, 'https://example.com/image.png', 0, new CachedUrl(undefined))
      ).rejects.toThrow(
        kind === 'empty' ? 'no body'
        : kind === 'error' ? 'read failed'
        : '25 MiB'
      );
      await expect(readFile(join(directory, '0.png'))).rejects.toMatchObject({ code: 'ENOENT' });
      if (kind === 'stream') {
        expect(chunks).toBeLessThan(30);
        expect(cancelled).toHaveBeenCalledOnce();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
