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
    const result = spawnSync(
      'bash',
      [resolve('scripts/operations/botge-control.sh'), 'deploy', value],
      { encoding: 'utf8', env: environment }
    );
    assert.equal(result.status, 1);
    assert.equal(readFileSync(commands, 'utf8'), '');
  }
);

test('client forwards an immutable digest without evaluating it', () => {
  const result = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy', digest],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(result.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), `DEPLOY ${digest}\n`);
});

test.each(['up', 'stop', 'deploy'])('client sends the %s request and accepts only OK', (action) => {
  const result = spawnSync('bash', [resolve('scripts/operations/botge-control.sh'), action], {
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), action.toUpperCase() + '\n');
});

test.each(['BUSY', 'ERROR', 'DENIED', 'unexpected'])(
  'client reports a non-success response: %s',
  (response) => {
    const result = spawnSync('bash', [resolve('scripts/operations/botge-control.sh'), 'deploy'], {
      encoding: 'utf8',
      env: { ...environment, TEST_RESPONSE: response }
    });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(response));
  }
);

test('client rejects unexpected arguments before opening a connection', () => {
  const result = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy', 'extra'],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(result.status, 1);
  assert.equal(readFileSync(commands, 'utf8'), '');
});

test('client reports transport errors', () => {
  const result = spawnSync('bash', [resolve('scripts/operations/botge-control.sh'), 'deploy'], {
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

test('manual DEPLOY without a digest logs and uses the pinned .botge-image', () => {
  writeFileSync(join(directory, '.botge-image'), previous + '\n');
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "\${BOTGE_IMAGE:-}" >> "$TEST_COMMANDS"
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY\n',
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(result.stderr.includes(`Deploying pinned image from .botge-image: ${previous}.`));
  assert.ok(
    readFileSync(commands, 'utf8').includes(
      `compose up -d --no-deps --pull always --wait --wait-timeout 120 botge ${previous}\n`
    )
  );
});

const previousQuantum = `mrewy/botge-quantum@sha256:${'c'.repeat(64)}`;

test('client forwards deploy-quantum with and without a digest', () => {
  const withDigest = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy-quantum', digest],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(withDigest.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), `DEPLOY_QUANTUM ${digest}\n`);

  const withoutDigest = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy-quantum'],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(withoutDigest.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), 'DEPLOY_QUANTUM\n');
});

test('quantum digest deployment skips cleanly when quantum service is not configured', () => {
  stub(
    'docker',
    `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\n' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_QUANTUM ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(result.stderr.includes('Quantum sidecar is not configured in Compose; skipping.'));
  assert.throws(() => readFileSync(join(directory, '.botge-quantum-image')));
});

test('quantum digest deployment verifies readiness and persists .botge-quantum-image', () => {
  stub(
    'docker',
    `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nquantum\\n' ;;
  'compose config --format json') printf '{"services":{"quantum":{"image":"%s"}}}' "$BOTGE_QUANTUM_IMAGE" ;;
  'compose ps -q quantum') echo qcontainer ;;
  'inspect --format {{.Config.Image}} qcontainer') echo "$BOTGE_QUANTUM_IMAGE" ;;
  'inspect --format {{.State.Health.Status}} qcontainer') echo healthy ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_QUANTUM ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK\n');
  assert.equal(
    readFileSync(join(directory, '.botge-quantum-image'), 'utf8'),
    `mrewy/botge-quantum@${digest}\n`
  );
});

test('quantum digest deployment refuses Compose without BOTGE_QUANTUM_IMAGE', () => {
  stub(
    'docker',
    `
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nquantum\\n' ;;
  'compose config --format json') echo '{"services":{"quantum":{"image":"mrewy/botge-quantum:latest"}}}' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_QUANTUM ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
});

test('failed quantum digest deployment rolls back to previous .botge-quantum-image', () => {
  writeFileSync(join(directory, '.botge-quantum-image'), previousQuantum + '\n');
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "$BOTGE_QUANTUM_IMAGE" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nquantum\\n' ;;
  'compose config --format json') printf '{"services":{"quantum":{"image":"%s"}}}' "$BOTGE_QUANTUM_IMAGE" ;;
  'compose up -d --no-deps --pull always --wait --wait-timeout 120 quantum') exit 1 ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_QUANTUM ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
  assert.ok(result.stderr.includes(`Restored the previous quantum image ${previousQuantum}.`));
  assert.equal(
    readFileSync(join(directory, '.botge-quantum-image'), 'utf8'),
    previousQuantum + '\n'
  );
});

test('manual DEPLOY_QUANTUM without a digest logs and uses .botge-quantum-image', () => {
  writeFileSync(join(directory, '.botge-quantum-image'), previousQuantum + '\n');
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "\${BOTGE_QUANTUM_IMAGE:-}" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nquantum\\n' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY_QUANTUM\n',
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(
    result.stderr.includes(
      `Deploying pinned quantum image from .botge-quantum-image: ${previousQuantum}.`
    )
  );
  assert.ok(
    readFileSync(commands, 'utf8').includes(
      `compose up -d --no-deps --pull always --wait --wait-timeout 120 quantum ${previousQuantum}\n`
    )
  );
});

const previousChemistry = `mrewy/botge-chemistry@sha256:${'d'.repeat(64)}`;

test('client forwards deploy-chemistry with and without a digest', () => {
  const withDigest = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy-chemistry', digest],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(withDigest.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), `DEPLOY_CHEMISTRY ${digest}\n`);

  const withoutDigest = spawnSync(
    'bash',
    [resolve('scripts/operations/botge-control.sh'), 'deploy-chemistry'],
    { encoding: 'utf8', env: environment }
  );
  assert.equal(withoutDigest.status, 0);
  assert.equal(readFileSync(commands, 'utf8'), 'DEPLOY_CHEMISTRY\n');
});

test('chemistry digest deployment skips cleanly when chemistry service is not configured', () => {
  stub(
    'docker',
    `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\n' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_CHEMISTRY ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(result.stderr.includes('Chemistry sidecar is not configured in Compose; skipping.'));
  assert.throws(() => readFileSync(join(directory, '.botge-chemistry-image')));
});

test('chemistry digest deployment verifies readiness and persists .botge-chemistry-image', () => {
  stub(
    'docker',
    `
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nchemistry\\n' ;;
  'compose config --format json') printf '{"services":{"chemistry":{"image":"%s"}}}' "$BOTGE_CHEMISTRY_IMAGE" ;;
  'compose ps -q chemistry') echo ccontainer ;;
  'inspect --format {{.Config.Image}} ccontainer') echo "$BOTGE_CHEMISTRY_IMAGE" ;;
  'inspect --format {{.State.Health.Status}} ccontainer') echo healthy ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_CHEMISTRY ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK\n');
  assert.equal(
    readFileSync(join(directory, '.botge-chemistry-image'), 'utf8'),
    `mrewy/botge-chemistry@${digest}\n`
  );
});

test('chemistry digest deployment refuses Compose without BOTGE_CHEMISTRY_IMAGE', () => {
  stub(
    'docker',
    `
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nchemistry\\n' ;;
  'compose config --format json') echo '{"services":{"chemistry":{"image":"mrewy/botge-chemistry:latest"}}}' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_CHEMISTRY ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
});

test('failed chemistry digest deployment rolls back to previous .botge-chemistry-image', () => {
  writeFileSync(join(directory, '.botge-chemistry-image'), previousChemistry + '\n');
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "$BOTGE_CHEMISTRY_IMAGE" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nchemistry\\n' ;;
  'compose config --format json') printf '{"services":{"chemistry":{"image":"%s"}}}' "$BOTGE_CHEMISTRY_IMAGE" ;;
  'compose up -d --no-deps --pull always --wait --wait-timeout 120 chemistry') exit 1 ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: `DEPLOY_CHEMISTRY ${digest}\n`,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, 'ERROR\n');
  assert.ok(result.stderr.includes(`Restored the previous chemistry image ${previousChemistry}.`));
  assert.equal(
    readFileSync(join(directory, '.botge-chemistry-image'), 'utf8'),
    previousChemistry + '\n'
  );
});

test('manual DEPLOY_CHEMISTRY without a digest logs and uses .botge-chemistry-image', () => {
  writeFileSync(join(directory, '.botge-chemistry-image'), previousChemistry + '\n');
  stub(
    'docker',
    `
printf '%s %s\\n' "$*" "\${BOTGE_CHEMISTRY_IMAGE:-}" >> "$TEST_COMMANDS"
case "$*" in
  'compose config --services') printf 'nginx\\nbotge\\nchemistry\\n' ;;
esac
`
  );
  const result = spawnSync('bash', [resolve('botge_control/bin/botge_control.sh')], {
    input: 'DEPLOY_CHEMISTRY\n',
    encoding: 'utf8',
    env: environment
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'OK\n');
  assert.ok(
    result.stderr.includes(
      `Deploying pinned chemistry image from .botge-chemistry-image: ${previousChemistry}.`
    )
  );
  assert.ok(
    readFileSync(commands, 'utf8').includes(
      `compose up -d --no-deps --pull always --wait --wait-timeout 120 chemistry ${previousChemistry}\n`
    )
  );
});
