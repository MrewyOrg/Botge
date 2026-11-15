import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, test } from 'vitest';

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
] as const)(
  'handler accepts %s and waits for Compose when starting containers',
  (request, expected) => {
    const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
      input: request + '\n',
      encoding: 'utf8',
      env: environment
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'OK\n');
    assert.ok(readFileSync(commands, 'utf8').includes(expected));
  }
);

test.each(['RESTART', 'DEPLOY; touch unexpected', '', 'x'.repeat(100)])(
  'handler denies malformed input without running Docker: %s',
  (request) => {
    const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
      input: request + '\n',
      encoding: 'utf8',
      env: environment
    });
    assert.notEqual(result.status, 0);
    assert.ok(['DENIED\n', 'ERROR\n'].includes(result.stdout));
    assert.equal(readFileSync(commands, 'utf8'), '');
  }
);

test('busy operations cannot run Docker', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_LOCK_STATUS: '1' }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'BUSY\n');
  assert.equal(readFileSync(commands, 'utf8'), '');
});

test('Compose failure is reported and cannot be disguised by cleanup', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_DOCKER_STATUS: '1' }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
  assert.ok(!readFileSync(commands, 'utf8').includes('image prune'));
});

test('deployment retains previous images for rollback', () => {
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: { ...environment, TEST_PRUNE_STATUS: '1' }
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(!readFileSync(commands, 'utf8').includes('image prune'));
});

const digest = 'sha256:' + 'a'.repeat(64);

test.each([
  'compose config --format json',
  'inspect --format {{.Config.Image}} container',
  'inspect --format {{.State.Health.Status}} container'
])(
  'digest deployment rejects a failed verification command despite matching output: %s',
  (command) => {
    stub(
      'docker',
      `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --format json') printf '{"services":{"botge":{"image":"%s"}}}' "$BOTGE_IMAGE" ;;
  'compose ps -q botge') echo container ;;
  'inspect --format {{.Config.Image}} container') echo "$BOTGE_IMAGE" ;;
  'inspect --format {{.State.Health.Status}} container') echo healthy ;;
esac
if [ "$*" = "$TEST_FAIL_COMMAND" ]; then exit 1; fi
`
    );
    const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
      input: 'DEPLOY ' + digest + '\n',
      encoding: 'utf8',
      env: { ...environment, TEST_FAIL_COMMAND: command }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, 'ERROR\n');
    assert.throws(() => readFileSync(join(directory, '.botge-image')));
  }
);

test('digest deployment verifies readiness and persists only the approved image', () => {
  stub(
    'docker',
    `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --format json') printf '{"services":{"botge":{"image":"%s"}}}' "$BOTGE_IMAGE" ;;
  'compose ps -q botge') echo container ;;
  'inspect --format {{.Config.Image}} container') echo "$BOTGE_IMAGE" ;;
  'inspect --format {{.State.Health.Status}} container') echo healthy ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY ' + digest + '\n',
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(directory, '.botge-image'), 'utf8'), `mrewy/botge@${digest}\n`);
});

test('digest deployment refuses a host Compose file that ignores the image pin', () => {
  stub('docker', 'echo \'{"services":{"botge":{"image":"mrewy/botge:latest"}}}\'\n');
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY ' + digest + '\n',
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
});

test.each(['sha256:bad', 'sha256:' + 'a'.repeat(64) + ';bad'])(
  'client rejects malformed digest %s',
  (value) => {
    const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), 'deploy', value], {
      encoding: 'utf8',
      env: environment
    });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(commands, 'utf8'), '');
  }
);

test('client forwards an immutable digest without evaluating it', () => {
  const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), 'deploy', digest], {
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), `DEPLOY ${digest}\n`);
});

test.each(['up', 'stop', 'deploy'])('client sends the %s request and accepts only OK', (action) => {
  const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), action], {
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), action.toUpperCase() + '\n');
});

test.each(['BUSY', 'ERROR', 'DENIED', 'unexpected'])(
  'client reports a non-success response: %s',
  (response) => {
    const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), 'deploy'], {
      encoding: 'utf8',
      env: { ...environment, TEST_RESPONSE: response }
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(response));
  }
);

test('client rejects unexpected arguments before opening a connection', () => {
  const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), 'deploy', 'extra'], {
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(readFileSync(commands, 'utf8'), '');
});

test('client reports transport errors', () => {
  const result = spawnSync('bash', [resolve('scripts/botge-control.sh'), 'deploy'], {
    encoding: 'utf8',
    env: { ...environment, TEST_TRANSPORT_STATUS: '7' }
  });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Unable to communicate'));
});

const previous = `mrewy/botge@sha256:${'b'.repeat(64)}`;
const rollbackCommand = 'compose up -d --no-deps --wait --wait-timeout 120 botge';

/**
 * Stubs Docker for a digest deployment, logging each command with the image it ran under.
 *
 * @param failure - The deployment stage that fails: the candidate start, its health, or both
 *   the candidate start and the rollback.
 */
function deploymentDocker(failure: 'start' | 'health' | 'rollback'): void {
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "$BOTGE_IMAGE" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --format json') printf '{"services":{"botge":{"image":"%s"}}}' "$BOTGE_IMAGE" ;;
  'compose up -d --no-deps --pull always --wait --wait-timeout 120 botge')
    [ "${failure}" = health ] || exit 1 ;;
  '${rollbackCommand}') [ "${failure}" != rollback ] || exit 1 ;;
  'compose ps -q botge') echo container ;;
  'inspect --format {{.Config.Image}} container') echo "$BOTGE_IMAGE" ;;
  'inspect --format {{.State.Health.Status}} container') echo unhealthy ;;
esac
`
  );
}

function deploy(): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY ' + digest + '\n',
    encoding: 'utf8',
    env: environment
  });
}

test.each(['start', 'health'] as const)(
  'a candidate that fails at %s is replaced by the previous verified image',
  (failure) => {
    writeFileSync(join(directory, '.botge-image'), previous + '\n');
    deploymentDocker(failure);
    const result = deploy();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'ERROR\n');
    assert.ok(String(result.stderr).includes(`Restored the previous image ${previous}.`));
    assert.ok(readFileSync(commands, 'utf8').includes(`${rollbackCommand} ${previous}\n`));
    assert.equal(readFileSync(join(directory, '.botge-image'), 'utf8'), previous + '\n');
  }
);

test('a failed candidate without a verified previous image is left for the operator', () => {
  deploymentDocker('start');
  const result = deploy();
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
  assert.ok(String(result.stderr).includes('No verified previous image to restore.'));
  assert.ok(!readFileSync(commands, 'utf8').includes(`${rollbackCommand} `));
});

test('a failed rollback still reports the failed deployment', () => {
  writeFileSync(join(directory, '.botge-image'), previous + '\n');
  deploymentDocker('rollback');
  const result = deploy();
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
  assert.ok(String(result.stderr).includes(`Could not restore the previous image ${previous}.`));
});
