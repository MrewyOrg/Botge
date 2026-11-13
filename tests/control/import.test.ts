import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, test } from 'vitest';

let directory: string;
let script: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'botge-import-test-'));
  const download = join(directory, 'botge-test', 'botge_control');
  mkdirSync(download, { recursive: true });
  script = join(download, 'import_data');
  copyFileSync(resolve('botge_control/import_data.sh'), script);
  writeFileSync(
    join(download, 'config'),
    'BOTGE_CONTROL_UID="$TEST_UID"\nBOTGE_DIR="$TEST_APP"\nBOTGE_RUNTIME_DIR="$TEST_RUNTIME"\n'
  );
  environment = {
    ...process.env,
    PATH: directory + ':' + (process.env['PATH'] ?? ''),
    TEST_UID: String(process.getuid?.() ?? 0),
    TEST_APP: directory,
    TEST_RUNTIME: directory,
    TEST_COMMANDS: join(directory, 'commands'),
    TEST_COMPOSE_CONFIG: JSON.stringify({ services: { botge: {} } })
  };
  writeFileSync(join(directory, 'commands'), '');
  writeFileSync(join(directory, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(
    join(directory, 'docker'),
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --format json') printf '%s' "$TEST_COMPOSE_CONFIG" ;;
  'compose run '*)
    if [ "\${TEST_CHECK_RUNTIME:-0}" = 1 ]; then
      for argument do source=$argument; done
      exec sh -ec "$source"
    fi
    ;;
esac
`,
    { mode: 0o700 }
  );
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test.each(['/tmp/data', 'data'])('import rejects unsupported image defaults at runtime', (data) => {
  const result = spawnSync('bash', [script, '--receive'], {
    cwd: directory,
    env: { ...environment, TEST_CHECK_RUNTIME: '1', BOTGE_DATA_DIR: data },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Import requires the'));
  assert.ok(!result.stderr.includes('find:'));
});

test.each([
  { environment: { BOTGE_DATA_DIR: '/tmp/data' } },
  { environment: { BOTGE_DATA_DIR: '' } },
  { working_dir: '/other', environment: { BOTGE_DATA_DIR: 'data' } }
] as const)('import rejects unsupported data paths before stopping Botge', (botge) => {
  const result = spawnSync('bash', [script, '--receive'], {
    env: { ...environment, TEST_COMPOSE_CONFIG: JSON.stringify({ services: { botge } }) },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Botge was not stopped'));
  const calls = readFileSync(join(directory, 'commands'), 'utf8');
  assert.ok(!calls.includes('compose stop'));
  assert.ok(!calls.includes('compose run'));
});

test.each([
  {},
  { environment: { BOTGE_DATA_DIR: './data' } },
  { working_dir: '/other', environment: { BOTGE_DATA_DIR: '/app/data' } }
] as const)('import accepts the supported database location', (botge) => {
  const result = spawnSync('bash', [script, '--receive'], {
    env: { ...environment, TEST_COMPOSE_CONFIG: JSON.stringify({ services: { botge } }) },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(join(directory, 'commands'), 'utf8');
  assert.ok(calls.indexOf('compose config') < calls.indexOf('compose stop'));
  assert.ok(calls.includes('compose run --rm --no-deps -T --user node'));
});
