import { afterEach, expect, test, vi } from 'vitest';

import { resolveTenorMedia } from 'src/api/tenor/resolve-media.ts';
import { requireValue } from 'src/utils/validation.ts';

afterEach(() => vi.unstubAllGlobals());

test('Tenor previews follow IDs rather than missing or reordered response positions', async () => {
  const media = ['1', '2', '1'].map((id) => ({
    name: id,
    url: `https://tenor.com/view/image-${id}`,
    dateAdded: new Date(0)
  }));
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      Response.json({
        results: [{ id: '2', media_formats: { tinygif: { url: 'https://example.com/2.gif' } } }]
      })
    );
  vi.stubGlobal('fetch', fetchMock);
  const result = await resolveTenorMedia(media, 'test-key');
  expect(result[0]).toEqual(media[0]);
  expect(result[1]).toMatchObject({ tenorUrl: 'https://example.com/2.gif' });
  expect(result[2]).toEqual(media[2]);
  expect(await resolveTenorMedia(media, '')).toBe(media);
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('previews are deduplicated and requested in batches of at most 50', async () => {
  const media = Array.from({ length: 101 }, (_, index) => ({
    name: String(index),
    url: `https://tenor.com/view/image-${index}`,
    dateAdded: new Date(0)
  }));
  const fetch = vi
    .fn<(input: string) => Promise<Response>>()
    .mockImplementation(async (input: string) => {
      const ids = new URL(input).searchParams.get('ids')?.split(',') ?? [];
      return await Promise.resolve(
        Response.json({
          results: ids.map((id) => ({
            id,
            media_formats: { tinygif: { url: `https://example.com/${id}.gif` } }
          }))
        })
      );
    });
  vi.stubGlobal('fetch', fetch);
  const result = await resolveTenorMedia(
    [...media, requireValue(media[0], 'Expected indexed test value.')],
    'key & value'
  );
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    fetch.mock.calls.map(
      ([url]: readonly [string]) => new URL(url).searchParams.get('ids')?.split(',').length
    )
  ).toEqual([50, 50, 1]);
  expect(
    new URL(requireValue(fetch.mock.calls[0], 'Expected indexed test value.')[0]).searchParams.get(
      'key'
    )
  ).toBe('key & value');
  expect(result[101]).toEqual(result[0]);
  expect(result[100]).toMatchObject({ tenorUrl: 'https://example.com/100.gif' });
  expect(media[0]).not.toHaveProperty('tenorUrl');
});

test.each([
  'https://tenor.com.evil.example/view/image-1',
  'https://example.com/image-1',
  'not a URL'
])('non-Tenor media never initiates a lookup: %s', async (url) => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const media = [{ name: 'saved', url, dateAdded: new Date(0) }];
  expect(await resolveTenorMedia(media, 'key')).toEqual(media);
  expect(fetch).not.toHaveBeenCalled();
});

test('missing preview formats retain the saved URL and upstream failures propagate', async () => {
  const media = [{ name: 'saved', url: 'https://tenor.com/view/image-1', dateAdded: new Date(0) }];
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ results: [{ id: '1', media_formats: {} }] }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  expect(await resolveTenorMedia(media, 'key')).toEqual(media);
  await expect(resolveTenorMedia(media, 'key')).rejects.toMatchObject({ status: 503 });
});

test('malformed Tenor previews are rejected instead of becoming saved URLs', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ results: [{ id: '1', media_formats: { tinygif: { url: 42 } } }] })
      )
  );
  await expect(
    resolveTenorMedia(
      [{ name: 'saved', url: 'https://tenor.com/view/image-1', dateAdded: new Date(0) }],
      'key'
    )
  ).rejects.toThrow('Invalid Tenor posts');
});
