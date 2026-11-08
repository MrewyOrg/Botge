import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

let directory: string;
let commands: string;
let environment: NodeJS.ProcessEnv;

function stub(name: string, source: string): void {
  writeFileSync(join(directory, 'bin', name), '#!/bin/sh\nset -eu\n' + source, { mode: 0o700 });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'botge-control-test-'));
  mkdirSync(join(directory, 'bin'));
  commands = join(directory, 'commands');
  writeFileSync(commands, '');
  environment = {
    ...process.env,
    PATH: join(directory, 'bin') + ':' + (process.env['PATH'] ?? ''),
    BOTGE_DIR: directory,
    BOTGE_RUNTIME_DIR: directory,
    BOTGE_CONTROL_LOCK: join(directory, 'control.lock'),
    BOTGE_CONTROL_SOCKET: join(directory, 'test.sock'),
    TEST_COMMANDS: commands,
    TEST_LOCK_STATUS: '0',
    TEST_PRUNE_STATUS: '0',
    TEST_DOCKER_STATUS: '0',
    TEST_TRANSPORT_STATUS: '0',
    TEST_RESPONSE: 'OK'
  };
  stub('flock', 'exit "$TEST_LOCK_STATUS"\n');
  stub(
    'docker',
    'printf "%s\\n" "$*" >> "$TEST_COMMANDS"\nif [ "$1" = image ]; then exit "$TEST_PRUNE_STATUS"; fi\nexit "$TEST_DOCKER_STATUS"\n'
  );
  stub(
    'socat',
    'cat > "$TEST_COMMANDS"\nprintf "%s\\n" "$TEST_RESPONSE"\nexit "$TEST_TRANSPORT_STATUS"\n'
  );
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

test.each([
  ['UP', 'compose up -d --wait --wait-timeout 120'],
  ['STOP', 'compose stop'],
  ['DEPLOY', 'compose up -d --no-deps --pull always --wait --wait-timeout 120 botge']
])('handler accepts %s and waits for Compose when starting containers', (request, expected) => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control')], {
    input: request + '\n',
    encoding: 'utf8',
    env: environment
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('OK\n');
  expect(readFileSync(commands, 'utf8')).toContain(expected);
});

test.each(['RESTART', 'DEPLOY; touch unexpected', '', 'x'.repeat(100)])(
  'handler denies malformed input without running Docker: %s',
  (request) => {
    const result = spawnSync('bash', [resolve('botge_control/bin/botge_control')], {
      input: request + '\n',
      encoding: 'utf8',
      env: environment
    });
    expect(result.status).not.toBe(0);
    expect(['DENIED\n', 'ERROR\n']).toContain(result.stdout);
    expect(readFileSync(commands, 'utf8')).toBe('');
  }
);

test('busy operations cannot run Docker', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_LOCK_STATUS: '1' }
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('BUSY\n');
  expect(readFileSync(commands, 'utf8')).toBe('');
});

test('Compose failure is reported and cannot be disguised by cleanup', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_DOCKER_STATUS: '1' }
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('ERROR\n');
  expect(readFileSync(commands, 'utf8')).not.toContain('image prune');
});

test('cleanup failure does not falsely report a successful deployment as failed', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_PRUNE_STATUS: '1' }
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('OK\n');
  expect(result.stderr).toContain('cleanup failed');
});

test.each(['up', 'stop', 'deploy'])('client sends the %s request and accepts only OK', (action) => {
  const result = spawnSync('bash', [resolve('scripts/botge-control'), action], {
    encoding: 'utf8',
    env: environment
  });
  expect(result.status).toBe(0);
  expect(readFileSync(commands, 'utf8')).toBe(action.toUpperCase() + '\n');
});

test.each(['BUSY', 'ERROR', 'DENIED', 'unexpected'])(
  'client reports a non-success response: %s',
  (response) => {
    const result = spawnSync('bash', [resolve('scripts/botge-control'), 'deploy'], {
      encoding: 'utf8',
      env: { ...environment, TEST_RESPONSE: response }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(response);
  }
);

test('client rejects unexpected arguments before opening a connection', () => {
  const result = spawnSync('bash', [resolve('scripts/botge-control'), 'deploy', 'extra'], {
    encoding: 'utf8',
    env: environment
  });
  expect(result.status).toBe(1);
  expect(readFileSync(commands, 'utf8')).toBe('');
});

test('client reports transport errors', () => {
  const result = spawnSync('bash', [resolve('scripts/botge-control'), 'deploy'], {
    encoding: 'utf8',
    env: { ...environment, TEST_TRANSPORT_STATUS: '7' }
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unable to communicate');
});
