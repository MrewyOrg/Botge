import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REST, Routes } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { updateCommands } from 'src/discord/update-commands.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('command registration uses explicit credentials and honors the command cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-commands-'));
  try {
    vi.stubEnv('APP_ID', undefined);
    vi.stubEnv('DISCORD_TOKEN', undefined);
    const token = vi.spyOn(REST.prototype, 'setToken');
    const put = vi.spyOn(REST.prototype, 'put').mockResolvedValue([]);
    const path = join(directory, 'commands.txt');
    await updateCommands(path, [], [], 'application', 'test-token');
    expect(token).toHaveBeenCalledWith('test-token');
    expect(put).toHaveBeenCalledWith(Routes.applicationCommands('application'), { body: [] });
    expect(await readFile(path, 'utf8')).not.toBe('');
    await updateCommands(path, [], [], 'application', 'test-token');
    expect(put).toHaveBeenCalledOnce();
    await updateCommands(path, [], [], 'another-application', 'test-token');
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(Routes.applicationCommands('another-application'), {
      body: []
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing credentials fail before making a Discord request', async () => {
  const put = vi.spyOn(REST.prototype, 'put').mockResolvedValue([]);
  await expect(updateCommands('/unused', [], [], 'application', ' ')).rejects.toThrow(
    'DISCORD_TOKEN and APP_ID required.'
  );
  expect(put).not.toHaveBeenCalled();
});
