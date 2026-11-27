/* Runs the Q# language service linter, as VS Code does, over a Q# project and fails on findings. */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { argv, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  getLanguageService,
  type ILanguageService,
  type IPosition,
  type IProjectHost,
  loadWasmModule,
  type TargetProfile,
  type VSDiagnostic
} from 'qsharp-lang';
import type { DeepReadonly } from 'ts-essentials';

/** Profiles linted in order: Base as shipped, then Unrestricted for `@Config(Unrestricted)` code. */
const PROFILES: readonly TargetProfile[] = ['base', 'unrestricted'] as const;
/** Severities that fail the check; hints such as "not included in the current compilation" do not. */
const FAILING_SEVERITIES: ReadonlySet<VSDiagnostic['severity']> = new Set([
  'error',
  'warning'
] as const);
const MANIFEST = 'qsharp.json' as const;
const FILE_TYPE_FILE = 1 as const;
const FILE_TYPE_DIRECTORY = 2 as const;
const DOCUMENT_VERSION = 1 as const;
const START: Readonly<IPosition> = { line: 0, character: 0 } as const;
const TIMEOUT_MILLISECONDS = 30_000 as const;

/** One linter finding with a project-relative location. */
export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: VSDiagnostic['severity'];
  readonly message: string;
  readonly profile: TargetProfile;
};

/** The language service call used to wait for a compilation. */
type CompletionSource = Readonly<{ getCompletions: ILanguageService['getCompletions'] }>;

/**
 * Builds a read-only file system host for the language service.
 *
 * @param profile - Target profile written into every project manifest the service reads.
 * @returns A host that serves local files and never fetches GitHub dependencies.
 */
export function projectHost(profile: TargetProfile): IProjectHost {
  return {
    async readFile(uri: string): Promise<string | null> {
      const path = fileURLToPath(uri);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return null;
      }
      if (!path.endsWith(`/${MANIFEST}`)) return text;
      const manifest = JSON.parse(text) as unknown;
      if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return text;
      return JSON.stringify({ ...manifest, targetProfile: profile });
    },
    async listDirectory(uri: string): Promise<[string, number][]> {
      const directory = fileURLToPath(uri);
      const listed: [string, number][] = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const kind = entry.isDirectory() ? FILE_TYPE_DIRECTORY : FILE_TYPE_FILE;
        listed.push([pathToFileURL(join(directory, entry.name)).href, kind]);
      }
      return listed;
    },
    async resolvePath(base: string, path: string): Promise<string | null> {
      return Promise.resolve(pathToFileURL(resolve(fileURLToPath(base), path)).href);
    },
    async fetchGithub(owner: string, repo: string): Promise<string> {
      return Promise.reject(new Error(`GitHub dependency ${owner}/${repo} is not allowed`));
    },
    async findManifestDirectory(uri: string): Promise<string | null> {
      for (let directory = dirname(fileURLToPath(uri)); ; directory = dirname(directory)) {
        try {
          await stat(join(directory, MANIFEST));
          return pathToFileURL(directory).href;
        } catch {
          if (dirname(directory) === directory) return null;
        }
      }
    }
  };
}

/** Loads the language service's WebAssembly module from the installed package once. */
async function loadWasm(): Promise<void> {
  const entry = fileURLToPath(import.meta.resolve('qsharp-lang'));
  const bytes = await readFile(join(dirname(entry), '..', 'lib', 'web', 'qsc_wasm_bg.wasm'));
  await loadWasmModule(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** Lists the `.qs` files under `directory`, recursively and sorted. */
async function sources(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.qs'))
      files.push(join(entry.parentPath, entry.name));
  }
  return files.sort();
}

/**
 * Waits until the service has compiled `DOCUMENT_VERSION` of `uri`.
 *
 * `getCompletions` is the public call that waits for a document version; it gives up after two
 * seconds and marks its answer incomplete, so it is retried until complete or the deadline passes.
 * The service publishes diagnostics only for documents that have some, so their absence cannot
 * signal completion.
 *
 * @param service - Language service the document was sent to.
 * @param uri - Document to wait for.
 * @param timeout - Milliseconds to keep retrying before failing.
 */
export async function waitForCompilation(
  service: CompletionSource,
  uri: string,
  timeout: number = TIMEOUT_MILLISECONDS
): Promise<void> {
  const deadline = Date.now() + timeout;
  while ((await service.getCompletions(uri, DOCUMENT_VERSION, START)).isIncomplete === true) {
    if (Date.now() >= deadline) {
      throw new Error(`Q# language service did not compile ${uri} within ${timeout} ms`);
    }
  }
}

/**
 * Lints every source of one Q# project under one target profile.
 *
 * @param root - Directory that holds `qsharp.json` and `src/`.
 * @param profile - Target profile to compile and lint under.
 * @returns Findings at `error` or `warning` severity.
 */
async function lintProfile(root: string, profile: TargetProfile): Promise<readonly Finding[]> {
  const files = await sources(join(root, 'src'));
  const service = await getLanguageService(projectHost(profile));
  const published = new Map<string, DeepReadonly<VSDiagnostic[]>>();
  service.addEventListener(
    'diagnostics',
    ({ detail }: DeepReadonly<{ detail: { uri: string; diagnostics: VSDiagnostic[] } }>) => {
      published.set(detail.uri, detail.diagnostics);
    }
  );
  try {
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      await service.updateDocument(pathToFileURL(file).href, DOCUMENT_VERSION, text);
    }
    for (const file of files) await waitForCompilation(service, pathToFileURL(file).href);
  } finally {
    await service.dispose();
  }
  const findings: Finding[] = [];
  for (const [uri, diagnostics] of published) {
    for (const diagnostic of diagnostics) {
      if (!FAILING_SEVERITIES.has(diagnostic.severity)) continue;
      findings.push({
        file: relative(root, fileURLToPath(uri)),
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        severity: diagnostic.severity,
        message: diagnostic.message.replace(/\n[\s\S]*$/u, ''),
        profile
      });
    }
  }
  return findings;
}

/**
 * Lints a Q# project under every profile in {@link PROFILES} and merges repeated findings.
 *
 * @param root - Directory that holds `qsharp.json` and `src/`.
 * @returns Unique findings sorted by file, line and column.
 */
export async function lintProject(root: string): Promise<readonly Finding[]> {
  await loadWasm();
  const unique = new Map<string, Finding>();
  for (const profile of PROFILES) {
    for (const finding of await lintProfile(root, profile)) {
      const key = `${finding.file}:${finding.line}:${finding.column}:${finding.message}`;
      if (!unique.has(key)) unique.set(key, finding);
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column
  );
}

/**
 * Formats findings as `file:line:column: severity: message (profile)` lines.
 *
 * @param findings - Findings to print.
 * @returns One line per finding, each ending in a newline.
 */
export function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map(
      (finding) =>
        `${finding.file}:${finding.line}:${finding.column}: ${finding.severity}: `
        + `${finding.message} (${finding.profile})\n`
    )
    .join('');
}

/**
 * Lints the project named by the first argument, or `quantum`, and reports the findings.
 *
 * @param args - Command-line arguments after the script path.
 * @param write - Receives the report.
 * @returns The process exit code: 1 when any finding is reported, otherwise 0.
 */
export async function main(
  args: readonly string[],
  write: (text: string) => void
): Promise<number> {
  const root = resolve(args[0] ?? 'quantum');
  const findings = await lintProject(root);
  if (findings.length > 0) {
    write(formatFindings(findings));
    return 1;
  }
  write(`Q# lints clean in ${relative('.', root)}\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(argv.slice(2), (text) => stdout.write(text));
}
