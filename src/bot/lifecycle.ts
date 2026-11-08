import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { getVoiceConnections } from '@discordjs/voice';
import { type Client, Events } from 'discord.js';
import { gracefulShutdown, type Job, scheduleJob } from 'node-schedule';

import { logError } from '../utils/log-error.ts';

/** Prepare storage before databases or API token caches are opened. */
export async function prepareDirectories(
  databaseDirectory: string,
  temporaryDirectory: string
): Promise<void> {
  await mkdir(databaseDirectory, { recursive: true });
  await mkdir(temporaryDirectory, { recursive: true });
  await Promise.all(
    (await readdir(temporaryDirectory)).map(async (entry) => {
      await rm(join(temporaryDirectory, entry), { recursive: true, force: true });
    })
  );
}

/** Prevent overlapping runs and handle rejected callbacks inside the scheduler. */
export function scheduleTask(
  name: string,
  cron: string,
  task: () => void | Promise<void>
): Readonly<Job> {
  const active = new Set<'running'>();
  const job = scheduleJob(name, cron, async () => {
    if (active.has('running')) return;
    active.add('running');
    try {
      await task();
    } catch (error) {
      logError(error, `Error in scheduled task ${name}`);
    } finally {
      active.clear();
    }
  }) as Job | null;
  if (job === null) throw new Error(`Failed to schedule task ${name}.`);
  return job;
}

/** Drain scheduled work before closing databases; repeated requests share the same shutdown. */
export function createShutdown(client: Client, closeDatabases: () => void): () => Promise<void> {
  let shutdown: Promise<void> | undefined;
  return async (): Promise<void> => {
    shutdown ??= (async (): Promise<void> => {
      client.removeAllListeners(Events.MessageCreate);
      client.removeAllListeners(Events.InteractionCreate);
      client.removeAllListeners(Events.GuildDelete);
      try {
        await gracefulShutdown();
      } catch (error) {
        logError(error, 'Error stopping scheduled jobs');
      }
      for (const connection of getVoiceConnections().values()) {
        try {
          connection.destroy();
        } catch (error) {
          logError(error, 'Error destroying voice connection');
        }
      }
      try {
        await client.destroy();
      } catch (error) {
        logError(error, 'Error disconnecting Discord');
      } finally {
        closeDatabases();
      }
    })();
    await shutdown;
  };
}
