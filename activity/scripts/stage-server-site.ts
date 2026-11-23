/* Validates a production Vite build and stages the files the Go origin may serve. */

import type { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { stdout } from 'node:process';
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';

import { type DefaultTreeAdapterTypes, parse } from 'parse5';
import type { DeepReadonly } from 'ts-essentials';

import { isRecord } from '../src/validation.ts';

const MIME: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.jpg', 'image/jpeg'],
  ['.woff2', 'font/woff2']
] as const);

const FINGERPRINTED_FILE = /^assets\/[a-zA-Z\d][a-zA-Z\d_.-]*-[a-zA-Z\d_-]{8}\.[a-z\d]+$/u;
const ENCODINGS = ['identity', 'gzip', 'br'] as const;
const BUILD_URL = 'https://activity.invalid/index.html' as const;

type Encoding = (typeof ENCODINGS)[number];
type AssetSpec = {
  readonly mime: string;
  readonly fingerprinted: boolean;
  readonly encodings: readonly Encoding[];
};

/** Reads an original build output and rejects symbolic links along its path. */
async function readBuildFile(directory: string, name: string): Promise<Buffer> {
  const filename = join(directory, name);
  if ((await realpath(filename)) !== filename) throw new Error(`Symlink in build output: ${name}`);
  return readFile(filename);
}

/** Reads a list from a Vite manifest entry and rejects malformed values. */
function names(value: unknown): readonly string[] {
  if (value === undefined) return [] as const;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error('Invalid references in Vite manifest');
  }
  return value;
}

/** Collects the deployable files recorded by Vite, including lazy chunks and their assets. */
function approvedFiles(manifest: unknown): ReadonlySet<string> {
  if (!isRecord(manifest) || !Object.hasOwn(manifest, 'index.html')) {
    throw new Error('Vite manifest has no index.html entry');
  }
  const files = new Set(['index.html', 'catalog.json']);
  for (const entry of Object.values(manifest)) {
    if (!isRecord(entry) || typeof entry['file'] !== 'string') {
      throw new Error('Invalid entry in Vite manifest');
    }
    for (const file of [
      entry['file'],
      ...names(entry['css']),
      ...names(entry['assets'])
    ] as const) {
      if (!FINGERPRINTED_FILE.test(file) || !MIME.has(extname(file))) {
        throw new Error(`Unexpected Vite output: ${file}`);
      }
      files.add(file);
    }
    for (const key of [...names(entry['imports']), ...names(entry['dynamicImports'])] as const) {
      if (!Object.hasOwn(manifest, key)) throw new Error(`Missing Vite manifest entry: ${key}`);
    }
  }
  return files;
}

/** Checks static HTML references against the files approved for serving. */
function validateHTML(
  node: DeepReadonly<DefaultTreeAdapterTypes.Node>,
  approves: (name: string) => boolean
): void {
  if ('attrs' in node) {
    if (node.tagName === 'base') throw new Error('The staged index cannot override the asset base');
    for (const { name, value } of node.attrs) {
      if (name !== 'src' && !(name === 'href' && node.tagName === 'link')) continue;
      const url = new URL(value, BUILD_URL);
      if (url.origin !== new URL(BUILD_URL).origin || !approves(url.pathname.slice(1))) {
        throw new Error(`Index references an unstaged asset: ${value}`);
      }
    }
  }
  if ('childNodes' in node) {
    for (const child of node.childNodes) validateHTML(child, approves);
  }
}

/** Replaces the destination with a validated stage and restores the old directory on failure. */
async function publishStage(staged: string, target: string, backup: string): Promise<void> {
  let movedPrevious = false;
  try {
    await rename(target, backup);
    movedPrevious = true;
  } catch (error) {
    if (!isRecord(error) || error['code'] !== 'ENOENT') throw error;
  }
  try {
    await rename(staged, target);
  } catch (error) {
    if (movedPrevious) {
      try {
        await rename(backup, target);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Cannot restore previous site from ${backup}`,
          { cause: restoreError }
        );
      }
    }
    throw error;
  }
  if (movedPrevious) await rm(backup, { recursive: true });
}

/** Removes the temporary build and retains any backup that could not be moved back. */
async function cleanStage(temporary: string): Promise<void> {
  await rm(join(temporary, 'site'), { recursive: true, force: true });
  try {
    await rmdir(temporary);
  } catch (error) {
    if (!isRecord(error) || error['code'] !== 'ENOTEMPTY') throw error;
  }
}

/** Stages a fresh verified site and preserves the previous directory if replacement fails. */
export async function stageServerSite(
  input: string,
  output: string
): Promise<Readonly<Record<Encoding, number>>> {
  const directory = await realpath(input);
  const target = resolve(output);
  const files = approvedFiles(
    JSON.parse((await readBuildFile(directory, '.vite/manifest.json')).toString())
  );
  const index = await readBuildFile(directory, 'index.html');
  validateHTML(parse(index.toString()), (name) => files.has(name));

  await mkdir(dirname(target), { recursive: true });
  const lock = join(dirname(target), '.stage.lock');
  await mkdir(lock);
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(dirname(target), 'dist-stage-'));
    const staged = join(temporary, 'site');
    const backup = join(temporary, 'previous');
    const manifest: Record<string, AssetSpec> = {};
    const totals = { identity: 0, gzip: 0, br: 0 };
    for (const name of [...files].sort()) {
      const mime = MIME.get(extname(name));
      if (mime === undefined) throw new Error(`Unknown media type: ${name}`);
      const original = name === 'index.html' ? index : await readBuildFile(directory, name);
      const encoded = {
        identity: original,
        gzip: gzipSync(original, { level: 9 }),
        br: brotliCompressSync(original)
      } as const;
      if (
        !gunzipSync(encoded.gzip).equals(original)
        || !brotliDecompressSync(encoded.br).equals(original)
      ) {
        throw new Error(`Compression round trip failed: ${name}`);
      }
      for (const coding of ENCODINGS) {
        const filename = join(staged, coding, name);
        await mkdir(dirname(filename), { recursive: true });
        await writeFile(filename, encoded[coding]);
        totals[coding] += encoded[coding].length;
      }
      manifest[name] = { mime, fingerprinted: FINGERPRINTED_FILE.test(name), encodings: ENCODINGS };
    }
    await writeFile(join(staged, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

    await publishStage(staged, target, backup);
    return totals;
  } finally {
    try {
      if (temporary !== undefined) await cleanStage(temporary);
    } finally {
      await rmdir(lock);
    }
  }
}

if (import.meta.main) {
  const totals = await stageServerSite('activity/dist', 'activity/server/internal/site/dist');
  stdout.write(`Staged bytes by encoding ${JSON.stringify(totals)}\n`);
}
