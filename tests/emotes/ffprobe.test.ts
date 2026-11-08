import { beforeEach, expect, test, vi } from 'vitest';

import { getDimension, getFrameCount } from 'src/emotes/rendering/ffprobe-utils.ts';

const { execute } = vi.hoisted(() => ({
  execute:
    vi.fn<
      (
        file: string,
        args: readonly string[],
        options: Readonly<{ timeout: number }>,
        callback: (error: Readonly<Error> | null, stdout: string) => void
      ) => void
    >()
}));
vi.mock('node:child_process', () => ({ execFile: execute }));
beforeEach(() => {
  execute.mockReset();
});

function output(value: string, error: Readonly<Error> | null = null): void {
  execute.mockImplementation((_file, _args, _options, callback) => {
    callback(error, value);
  });
}

test.each(['', 'N/A', '0x20', '-1x20', '10x0', '1.5x20', 'invalid', '20xNaN'])(
  'invalid probe dimensions %j are rejected',
  async (value) => {
    output(value);
    expect(await getDimension('input.webp')).toBeUndefined();
  }
);

test('dimensions are trimmed and the filename is passed as a separate argument', async () => {
  output(' 128x64\n');
  expect(await getDimension('input with spaces.webp')).toEqual([128, 64]);
  expect(execute).toHaveBeenCalledWith(
    'ffprobe',
    expect.arrayContaining(['stream=width,height', 'input with spaces.webp']),
    { timeout: 60_000 },
    expect.any(Function)
  );
});

test.each([getDimension, getFrameCount])('probe errors return no metadata', async (probe) => {
  output('', new Error('probe failed'));
  expect(await probe('invalid.webp')).toBeUndefined();
});

test.each([
  ['', 1],
  ['N/A', 1],
  [' 24\n', 24],
  ['0', undefined],
  ['-2', undefined],
  ['1.5', undefined],
  ['bad', undefined]
] as const)('frame count %j produces %s', async (value, expected) => {
  output(value);
  expect(await getFrameCount('local.gif')).toBe(expected);
});

test.each(['http://example.com/a.gif', 'https://example.com/a.gif'])(
  'remote frame probes use the cache protocol: %s',
  async (url) => {
    output('3');
    expect(await getFrameCount(url)).toBe(3);
    expect(execute).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['cache:' + url]),
      { timeout: 60_000 },
      expect.any(Function)
    );
  }
);
