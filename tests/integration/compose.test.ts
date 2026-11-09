import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DockerComposeEnvironment,
  type StartedDockerComposeEnvironment,
  Wait
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

// Explicit integration run: BOTGE_TEST_COMPOSE=true npx vitest run tests/integration/compose.test.ts
// Uses local credentials to start a real bot. Never reuse the deployment's project name.
describe.runIf(process.env['BOTGE_TEST_COMPOSE'] === 'true')('Compose integration', () => {
  let environment: Readonly<StartedDockerComposeEnvironment> | undefined;
  let directory: string | undefined;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'botge-compose-'));
    const override = join(directory, 'override.json');
    await writeFile(
      override,
      JSON.stringify({ services: { nginx: { volumes: [`${directory}/cache:/var/www/cache:rw`] } } })
    );
    environment = await new DockerComposeEnvironment('.', [
      'compose.full.yaml',
      'compose.build.yaml',
      override
    ])
      .withBuild()
      .withProjectName(`botge-test-${randomUUID()}`)
      .withWaitStrategy('botge-1', Wait.forLogMessage(/Logged in as/u))
      .up();
  }, 180_000);

  test('starts the bot and its dependencies', () => {
    expect(environment).toBeDefined();
    for (const service of ['botge', 'nginx', 'meilisearch', 'chromadb']) {
      expect(environment?.getContainer(`${service}-1`).getId()).toBeTruthy();
    }
  });

  afterAll(async () => {
    try {
      await environment?.down();
    } finally {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
