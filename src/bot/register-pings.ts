import type { Client } from 'discord.js';
import scheduler, { type Job } from 'node-schedule';

import type { PingsDatabase } from '../database/pings-database.ts';
import { getContent } from '../message-builders/ping-for-ping-me-message-builder.ts';
import type { MutableArray } from '../types.ts';
import { logError } from '../utils/log-error.ts';
import { daysAndHoursAndMinutesToMilliseconds, getPingJobName } from './ping-utils.ts';

function millisecondsToHoursAndMinutes(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);

  const hoursText = hours > 0 ? `${hours} hours and ` : '';
  const minutesText = hours === 0 && minutes === 0 ? 'less than a minute' : `${minutes} minute`;

  return `${hoursText}${minutesText}`;
}

export async function registerPings(
  client: Client,
  pingsDatabase: Readonly<PingsDatabase>,
  scheduledJobs: MutableArray<Readonly<Job>>
): Promise<void> {
  const pings = pingsDatabase.getAll();

  for (const ping of pings) {
    const { time, days, hours, minutes, channelId } = ping;

    const timeMilliseconds =
      time + daysAndHoursAndMinutesToMilliseconds(days ?? 0, hours ?? 0, minutes ?? 0);
    const pingDate = new Date(timeMilliseconds);

    let channel: Awaited<ReturnType<Client['channels']['fetch']>>;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (error) {
      logError(error, `Failed to load reminder channel ${channelId}`);
      continue;
    }
    if (channel?.isSendable() !== true) continue;

    const difference = timeMilliseconds - Date.now();
    const pingedContent = getContent(ping, 'Pinged');
    if (difference > 0) {
      const jobName = getPingJobName(ping);
      const scheduledJob = scheduler.scheduleJob(jobName, pingDate, async () => {
        try {
          const currentPing = pingsDatabase.get(ping);
          if (currentPing === undefined) return;
          const deliveryChannel = await client.channels.fetch(channelId);
          if (deliveryChannel?.isSendable() !== true) return;
          await deliveryChannel.send(getContent(currentPing, 'Pinged'));
          pingsDatabase.delete(currentPing);
        } catch (error) {
          logError(error, 'Error at a scheduled job from registerPings');
        } finally {
          const index = scheduledJobs.findIndex(
            (job: Readonly<Pick<Job, 'name'>>) => job.name === jobName
          );
          if (index !== -1) scheduledJobs.splice(index, 1);
        }
      }) as Job | null;
      if (scheduledJob === null) throw new Error('Failed to schedule a stored ping.');
      scheduledJobs.push(scheduledJob);
    } else {
      try {
        await channel.send(
          `${pingedContent}\nSorry for the bot downtime! The ping was delivered with a ${millisecondsToHoursAndMinutes(-difference)} delay!`
        );
        pingsDatabase.delete(ping);
      } catch (error) {
        logError(error, `Failed to deliver overdue reminder in channel ${channelId}`);
      }
    }
  }
}
