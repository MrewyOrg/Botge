// cspell:words nokey noprint

import { execFile } from 'node:child_process';

export const DEFAULT_FRAME_COUNT = 1 as const;

export async function getDimension(
  filename: string
): Promise<readonly [number, number] | undefined> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=s=x:p=0',
        filename
      ],
      { timeout: 60_000 },
      (error: Readonly<Error> | null, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const widthAndHeight = stdout.trim();

        if (widthAndHeight === 'N/A' || widthAndHeight === '') {
          resolve(undefined);
        } else {
          const widthAndHeightSplit: readonly string[] = widthAndHeight.split('x');
          const width = Number(widthAndHeightSplit[0]);
          const height = Number(widthAndHeightSplit[1]);

          resolve(
            Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ?
              [width, height]
            : undefined
          );
        }
      }
    );
  });
}

export async function getFrameCount(filename: string): Promise<number | undefined> {
  let inputFilename = filename;
  if (filename.startsWith('http://') || filename.startsWith('https://'))
    inputFilename = `cache:${filename}`;

  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-count_frames',
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputFilename
      ],
      { timeout: 60_000 },
      (error: Readonly<Error> | null, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }

        const frameCount = stdout.trim();
        if (frameCount === 'N/A' || frameCount === '') resolve(DEFAULT_FRAME_COUNT);
        else {
          const count = Number(frameCount);
          resolve(Number.isInteger(count) && count > 0 ? count : undefined);
        }
      }
    );
  });
}
