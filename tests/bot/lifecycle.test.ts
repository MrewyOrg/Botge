import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client, Events } from 'discord.js';
import { gracefulShutdown, scheduledJobs, type default as scheduler } from 'node-schedule';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createShutdown, prepareDirectories, scheduleTask } from 'src/bot/lifecycle.ts';
import { logError } from 'src/utils/log-error.ts';
import { requireValue } from 'src/utils/validation.ts';

const { connections } = vi.hoisted(() => ({
  connections: new Map<string, { readonly destroy: () => void }>()
}));
vi.mock('@discordjs/voice', () => ({ getVoiceConnections: (): typeof connections => connections }));
vi.mock('src/utils/log-error.ts', () => ({ logError: vi.fn() }));
vi.mock('node-schedule', async () => {
  const actual = await vi.importActual<typeof scheduler>('node-schedule');
  return { ...actual, gracefulShutdown: vi.fn(actual.gracefulShutdown) };
});

beforeEach(() => {
  vi.clearAllMocks();
  connections.clear();
});
afterEach(() => {
  for (const job of Object.values(scheduledJobs)) job.cancel();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('storage preparation creates missing directories and clears only temporary contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'botge-lifecycle-'));
  try {
    const data = join(root, 'data');
    const temporary = join(data, 'tmp');
    await prepareDirectories(data, temporary);
    await writeFile(join(data, 'persistent.sqlite'), 'keep');
    await writeFile(join(temporary, 'file.png'), 'temporary');
    await mkdir(join(temporary, 'render'));
    await writeFile(join(temporary, 'render', 'frame.png'), 'temporary');
    await prepareDirectories(data, temporary);
    expect(await readdir(temporary)).toEqual([]);
    expect(await readFile(join(data, 'persistent.sqlite'), 'utf8')).toBe('keep');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Scheduled maintenance', () => {
  test('skips overlapping runs and resumes after a handled rejection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const pending = Promise.withResolvers<undefined>();
    const task = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    scheduleTask('maintenance', '* * * * * *', task);
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledOnce();
    const error = new Error('maintenance failed');
    pending.reject(error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(logError).toHaveBeenCalledWith(error, 'Error in scheduled task maintenance');
    expect(task).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid schedules immediately', () => {
    expect(() => scheduleTask('invalid', 'invalid cron', vi.fn())).toThrow(
      'Failed to schedule task invalid.'
    );
  });
});

describe('Shutdown', () => {
  test('waits for jobs before closing resources and runs only once', async () => {
    const client = new Client({ intents: [] });
    const destroy = vi.spyOn(client, 'destroy').mockResolvedValue(undefined);
    const close = vi.fn();
    const connection = { destroy: vi.fn() };
    connections.set('voice', connection);
    client.on(Events.MessageCreate, vi.fn());
    client.on(Events.InteractionCreate, vi.fn());
    const pending = Promise.withResolvers<undefined>();
    vi.mocked(gracefulShutdown).mockReturnValueOnce(pending.promise);
    const shutdown = createShutdown(client, close);
    const first = shutdown();
    const second = shutdown();
    expect(gracefulShutdown).toHaveBeenCalledOnce();
    expect(client.listenerCount(Events.MessageCreate)).toBe(0);
    expect(client.listenerCount(Events.InteractionCreate)).toBe(0);
    expect(close).not.toHaveBeenCalled();
    pending.resolve(undefined);
    await Promise.all([first, second]);
    expect(gracefulShutdown).toHaveBeenCalledOnce();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(destroy.mock.invocationCallOrder[0]).toBeLessThan(
      requireValue(close.mock.invocationCallOrder[0], 'Expected indexed test value.')
    );
    await shutdown();
    expect(close).toHaveBeenCalledOnce();
  });

  test('continues cleanup when jobs, voice connections, or Discord fail to stop', async () => {
    const client = new Client({ intents: [] });
    vi.spyOn(client, 'destroy').mockRejectedValue(new Error('Discord failed'));
    vi.mocked(gracefulShutdown).mockRejectedValueOnce(new Error('Scheduler failed'));
    connections.set('broken', {
      destroy: () => {
        throw new Error('Voice failed');
      }
    });
    const connection = { destroy: vi.fn() };
    connections.set('healthy', connection);
    const close = vi.fn();
    await createShutdown(client, close)();
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledTimes(3);
  });
});
