import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { expect, test } from 'vitest';

import { stageServerSite } from '../scripts/stage-server-site.ts';

async function createBuild(input: string, script: string): Promise<void> {
  await mkdir(join(input, '.vite'), { recursive: true });
  await mkdir(join(input, 'assets'), { recursive: true });
  await writeFile(
    join(input, '.vite/manifest.json'),
    JSON.stringify({
      'index.html': { file: script, dynamicImports: ['lazy'] },
      'lazy': { file: 'assets/lazy-abcdefgh.js' }
    } as const)
  );
  await writeFile(join(input, 'index.html'), `<script type="module" src="./${script}"></script>`);
  await writeFile(join(input, 'catalog.json'), '[]');
  await writeFile(join(input, script), 'export const original = true;');
  await writeFile(join(input, 'assets/lazy-abcdefgh.js'), 'export const lazy = true;');
}

test('stages only approved files and removes stale URLs on replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-stage-test-'));
  try {
    const input = join(directory, 'build');
    const output = join(directory, 'site');
    const oldScript = 'assets/app-abcdefgh.js' as const;
    const newScript = 'assets/app-87654321.js' as const;
    await createBuild(input, oldScript);
    for (const file of [
      '.env',
      '.assetsignore',
      '_headers',
      'catalog.json.gz',
      'assets/app-abcdefgh.js.map'
    ] as const) {
      await writeFile(join(input, file), 'private fixture');
    }
    const totals = await stageServerSite(input, output);
    expect(totals.identity).toBeGreaterThan(0);
    const original = await readFile(join(output, 'identity', oldScript));
    expect(gunzipSync(await readFile(join(output, 'gzip', oldScript)))).toEqual(original);
    expect(brotliDecompressSync(await readFile(join(output, 'br', oldScript)))).toEqual(original);
    const manifest = await readFile(join(output, 'manifest.json'), 'utf8');
    for (const file of [
      '.env',
      '.assetsignore',
      '_headers',
      'catalog.json.gz',
      'assets/app-abcdefgh.js.map'
    ] as const) {
      expect(manifest).not.toContain(file);
    }

    await writeFile(
      join(input, 'index.html'),
      '<script src="./assets/missing-abcdefgh.js"></script>'
    );
    await expect(stageServerSite(input, output)).rejects.toThrow('unstaged asset');
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(manifest);

    await createBuild(input, newScript);
    await rm(join(input, oldScript));
    await rm(join(input, 'assets/lazy-abcdefgh.js'));
    await expect(stageServerSite(input, output)).rejects.toThrow('lazy-abcdefgh.js');
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(manifest);

    await createBuild(input, newScript);
    await stageServerSite(input, output);
    const replacement = await readFile(join(output, 'manifest.json'), 'utf8');
    expect(replacement).toContain(newScript);
    expect(replacement).not.toContain(oldScript);
    await expect(readFile(join(output, 'identity', oldScript))).rejects.toMatchObject({
      code: 'ENOENT'
    } as const);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
