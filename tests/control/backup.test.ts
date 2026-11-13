import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, test } from 'vitest';

let directory: string;
let environment: NodeJS.ProcessEnv;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'botge-backup-test-'));
  environment = {
    ...process.env,
    PATH: directory + ':' + (process.env['PATH'] ?? ''),
    BOTGE_DIR: directory,
    BOTGE_CONTROL_LOCK: join(directory, 'lock'),
    TEST_COMMANDS: join(directory, 'commands'),
    TEST_VERIFY_STATUS: '0',
    TEST_CONTAINER_CONFIG: JSON.stringify({ WorkingDir: '/app', Env: [] })
  };
  writeFileSync(join(directory, 'commands'), '');
  for (const [name, source] of Object.entries({
    realpath: 'echo "$2"',
    flock: 'exit 0',
    sha256sum: 'echo "fixture  botge.redb"',
    docker: `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose ps -q --status running botge') echo container ;;
  'inspect --format {{.Image}} container') echo sha256:fixture ;;
  'inspect --format {{json .Config}} container') printf '%s' "$TEST_CONTAINER_CONFIG" ;;
  cp*) printf fixture > "$3" ;;
  run*) exit "$TEST_VERIFY_STATUS" ;;
esac`
  })) {
    writeFileSync(join(directory, name), '#!/bin/sh\nset -eu\n' + source + '\n', { mode: 0o700 });
  }
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test('offline backup stops, verifies, records checksum, and restarts the original container', () => {
  const destination = join(directory, 'backup');
  const result = spawnSync('bash', [resolve('scripts/backup-compose.sh'), destination], {
    env: environment,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(destination, 'SHA256SUMS')));
  const calls = readFileSync(join(directory, 'commands'), 'utf8');
  assert.ok(calls.indexOf('compose stop') < calls.indexOf('cp container:'));
  assert.ok(calls.includes('--verify-database /backup.redb'));
  assert.ok(calls.endsWith('compose start --wait --wait-timeout 120 botge\n'));
});

test('verification failure still restarts Botge and never records a successful checksum', () => {
  const destination = join(directory, 'backup');
  const result = spawnSync('bash', [resolve('scripts/backup-compose.sh'), destination], {
    env: { ...environment, TEST_VERIFY_STATUS: '1' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.ok(!existsSync(join(destination, 'SHA256SUMS')));
  assert.ok(readFileSync(join(directory, 'commands'), 'utf8').includes('compose start --wait'));
});

test('existing backup directories are refused before stopping the bot', () => {
  const result = spawnSync('bash', [resolve('scripts/backup-compose.sh'), directory], {
    env: environment,
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(join(directory, 'commands'), 'utf8'), '');
});

test.each([
  { WorkingDir: '/app', Env: ['BOTGE_DATA_DIR=/tmp/data'] },
  { WorkingDir: '/other', Env: ['BOTGE_DATA_DIR=data'] },
  { WorkingDir: '/app', Env: ['BOTGE_DATA_DIR='] }
] as const)(
  'nonstandard running data directories are refused before stopping or copying',
  (config) => {
    const destination = join(directory, 'backup');
    const result = spawnSync('bash', [resolve('scripts/backup-compose.sh'), destination], {
      env: { ...environment, TEST_CONTAINER_CONFIG: JSON.stringify(config) },
      encoding: 'utf8'
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('Botge was not stopped'));
    const calls = readFileSync(join(directory, 'commands'), 'utf8');
    assert.ok(!calls.includes('compose stop'));
    assert.ok(!calls.includes('cp container:'));
    assert.ok(!existsSync(destination));
  }
);

test('backup uses the running data directory rather than the caller environment', () => {
  const result = spawnSync(
    'bash',
    [resolve('scripts/backup-compose.sh'), join(directory, 'backup')],
    {
      env: {
        ...environment,
        BOTGE_DATA_DIR: '/unrelated/host/path',
        TEST_CONTAINER_CONFIG: JSON.stringify({
          WorkingDir: '/other',
          Env: ['BOTGE_DATA_DIR=/app/data']
        })
      },
      encoding: 'utf8'
    }
  );
  assert.equal(result.status, 0, result.stderr);
});
