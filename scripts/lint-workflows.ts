import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// actionlint 1.7.x predates GitHub's $/ syntax. Validate equivalent local references in
// temporary copies while retaining the checked-in syntax required by gh-actions-lock.
const shellcheck = spawnSync('shellcheck', ['--version'], { stdio: 'ignore' });
if (shellcheck.status !== 0)
  throw new Error('Install ShellCheck to validate inline workflow shell.');

const directory = mkdtempSync(join(tmpdir(), 'botge-actionlint-'));
try {
  const workflows = join(directory, '.github', 'workflows');
  mkdirSync(workflows, { recursive: true });
  mkdirSync(join(directory, '.git'));
  for (const name of readdirSync('.github/workflows')) {
    if (!/\.ya?ml$/u.test(name)) continue;
    const source = readFileSync(join('.github/workflows', name), 'utf8');
    writeFileSync(
      join(workflows, name),
      source.replace(/(?<prefix>\buses:\s*)\$\//gu, '$<prefix>./')
    );
  }
  const result = spawnSync('actionlint', ['-color=false'], { cwd: directory, stdio: 'inherit' });
  if (result.error !== undefined)
    console.error(
      'Install actionlint and ShellCheck before running workflow lint.',
      result.error.message
    );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
