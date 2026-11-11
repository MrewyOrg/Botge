import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// Explicit integration run: BOTGE_TEST_COMPOSE=true npm --prefix tests/integration test
// Uses local credentials to start a real bot. Never reuse the deployment's project name.
describe.runIf(process.env['BOTGE_TEST_COMPOSE'] === 'true')('Compose integration', () => {
  let environment: Readonly<StartedDockerComposeEnvironment> | undefined;
  let directory: string | undefined;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'botge-compose-'));
    const override = join(directory, 'override.json');
    await writeFile(
      override,
      JSON.stringify({
        services: {
          botge: { environment: { BOTGE_REGISTER_COMMANDS: 'false' } },
          nginx: { volumes: [`${directory}/cache:/var/www/cache:rw`] }
        }
      })
    );
    const projectDirectory = fileURLToPath(new URL('../../', import.meta.url));
    environment = await new DockerComposeEnvironment(projectDirectory, [
      'compose.yaml',
      'compose.build.yaml',
      override
    ])
      .withBuild()
      .withProjectName(`botge-test-${randomUUID()}`)
      .withWaitStrategy('botge-1', Wait.forLogMessage(/Discord gateway ready/u))
      .up();
  }, 180_000);

  test('reaches nginx over the Compose network after the bot logs in', async () => {
    if (environment === undefined) throw new Error('Compose did not start.');
    const health = await environment
      .getContainer('botge-1')
      .exec(['wget', '-q', '--spider', 'http://nginx/healthz']);
    expect(health.exitCode).toBe(0);
  });

  afterAll(async () => {
    try {
      await environment?.down();
    } finally {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
