import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  formatFindings,
  lintProject,
  main,
  projectHost,
  waitForCompilation
} from '../../scripts/quantum/lint-qsharp.ts';

const LANGUAGE_SERVICE_TIMEOUT = 60_000 as const;
const MANIFEST = JSON.stringify({
  targetProfile: 'base',
  lints: [{ lint: 'needlessParens', level: 'error' }]
} as const);
const CLEAN = 'function Twice(x : Int) : Int {\n    return 2 * x;\n}\n' as const;
// `+` and `-` bind tighter than `<<<`, so every parenthesis pair here is needless: two on one line
// and one on the next.
const BASE_LINT =
  'function Shift(j : Int, l : Int) : Int {\n'
  + '    let a = 1 <<< (j + l); let b = 1 <<< (j - l);\n'
  + '    return a <<< (b + 1);\n'
  + '}\n';
const UNRESTRICTED_LINT =
  '@Config(Unrestricted)\nfunction Hidden(j : Int) : Int {\n    return 1 <<< (j - 1);\n}\n' as const;

let workspace = '';

/** Writes a Q# project with `files` under `src/` and returns its root. */
async function project(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = join(workspace, name);
  await mkdir(join(root, 'src', 'nested'), { recursive: true });
  await writeFile(join(root, 'qsharp.json'), MANIFEST);
  for (const [file, text] of Object.entries(files)) await writeFile(join(root, 'src', file), text);
  return root;
}

beforeAll(async () => {
  workspace = await realpath(await mkdtemp(join(tmpdir(), 'botge-qsharp-lint-')));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('project host', () => {
  test('rewrites only the manifest target profile and serves other files unchanged', async () => {
    const root = await project('host', { 'A.qs': CLEAN, 'notes.txt': 'x' } as const);
    const host = projectHost('unrestricted');
    const manifest = await host.readFile(pathToFileURL(join(root, 'qsharp.json')).href);
    expect(JSON.parse(manifest ?? '{}')).toMatchObject({ targetProfile: 'unrestricted' });
    expect(await host.readFile(pathToFileURL(join(root, 'src', 'A.qs')).href)).toBe(CLEAN);
    expect(await host.readFile(pathToFileURL(join(root, 'missing.qs')).href)).toBeNull();

    const odd = join(workspace, 'odd');
    await mkdir(odd, { recursive: true });
    await writeFile(join(odd, 'qsharp.json'), '[]');
    expect(await host.readFile(pathToFileURL(join(odd, 'qsharp.json')).href)).toBe('[]');
  });

  test('lists directories, resolves paths, finds manifests and refuses GitHub', async () => {
    const root = await project('paths', { 'A.qs': CLEAN } as const);
    const host = projectHost('base');
    const listed = await host.listDirectory(pathToFileURL(join(root, 'src')).href);
    expect(new Map(listed)).toEqual(
      new Map([
        [pathToFileURL(join(root, 'src', 'A.qs')).href, 1],
        [pathToFileURL(join(root, 'src', 'nested')).href, 2]
      ])
    );
    expect(await host.resolvePath(pathToFileURL(root).href, 'src/A.qs')).toBe(
      pathToFileURL(join(root, 'src', 'A.qs')).href
    );
    expect(
      await host.findManifestDirectory(pathToFileURL(join(root, 'src', 'nested', 'B.qs')).href)
    ).toBe(pathToFileURL(root).href);
    expect(await host.findManifestDirectory(pathToFileURL('/no-such-dir/B.qs').href)).toBeNull();
    await expect(host.fetchGithub('owner', 'repo', 'ref', 'path')).rejects.toThrow(
      'GitHub dependency owner/repo is not allowed'
    );
  });
});

describe('waiting for a compilation', () => {
  test('retries incomplete answers and gives up at the deadline', async () => {
    const answers = [true, true, false];
    const calls: string[] = [];
    const service = {
      getCompletions: async (uri: string) => {
        calls.push(uri);
        return Promise.resolve({ items: [], isIncomplete: answers.shift() ?? false });
      }
    } as const;
    await waitForCompilation(service, 'file:///a.qs');
    expect(calls).toHaveLength(3);

    const stuck = {
      getCompletions: async () => Promise.resolve({ items: [], isIncomplete: true })
    } as const;
    await expect(waitForCompilation(stuck, 'file:///b.qs', 0)).rejects.toThrow(
      'did not compile file:///b.qs within 0 ms'
    );
  });
});

describe('linting', () => {
  test(
    'reports Base findings once and finds lints only Unrestricted builds include',
    async () => {
      const root = await project('lints', {
        'Base.qs': BASE_LINT,
        'nested/Hidden.qs': UNRESTRICTED_LINT,
        'Clean.qs': CLEAN,
        'readme.md': 'not Q#'
      } as const);
      const findings = await lintProject(root);
      const finding = (file: string, line: number, column: number, profile: string) =>
        ({
          file,
          line,
          column,
          severity: 'error',
          message: 'unnecessary parentheses',
          profile
        }) as const;
      expect(findings).toEqual([
        finding('src/Base.qs', 2, 19, 'base'),
        finding('src/Base.qs', 2, 42, 'base'),
        finding('src/Base.qs', 3, 18, 'base'),
        finding('src/nested/Hidden.qs', 3, 18, 'unrestricted')
      ]);
      expect(formatFindings(findings.slice(-2))).toBe(
        'src/Base.qs:3:18: error: unnecessary parentheses (base)\n'
          + 'src/nested/Hidden.qs:3:18: error: unnecessary parentheses (unrestricted)\n'
      );
    },
    LANGUAGE_SERVICE_TIMEOUT
  );

  test(
    'main exits 1 with findings and 0 with a clean report',
    async () => {
      const dirty = await project('dirty', { 'Base.qs': BASE_LINT } as const);
      const clean = await project('clean', { 'Clean.qs': CLEAN } as const);
      const output: string[] = [];
      const write = (text: string): void => {
        output.push(text);
      };
      expect(await main([dirty], write)).toBe(1);
      expect(await main([clean], write)).toBe(0);
      expect(output[0]).toContain('src/Base.qs:2:19: error: unnecessary parentheses (base)');
      expect(output[1]).toMatch(/^Q# lints clean in .*clean\n$/u);
      // Without an argument, the repository's own `quantum/` project is linted and must be clean.
      expect(await main([], write)).toBe(0);
      expect(output[2]).toBe('Q# lints clean in quantum\n');
    },
    LANGUAGE_SERVICE_TIMEOUT
  );
});
