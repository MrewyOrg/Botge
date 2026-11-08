import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function shellFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry: Readonly<Dirent>) => {
    if (entry.name === '_') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shellFiles(path);
    if (!entry.isFile()) return [];
    const [firstLine] = readFileSync(path, 'utf8').split('\n', 1);
    return /^#!.*\b(?:ba)?sh\b/u.test(firstLine ?? '') ? [path] : [];
  });
}

const files = ['botge_control', 'scripts', '.husky'].flatMap(shellFiles);
const result = spawnSync('shellcheck', ['--external-sources', '--source-path=.', ...files], {
  stdio: 'inherit'
});
if (result.error !== undefined)
  console.error('Install ShellCheck before running shell lint.', result.error.message);
process.exitCode = result.status ?? 1;
