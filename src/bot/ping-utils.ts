import type { Ping } from '../types.ts';

export function daysAndHoursAndMinutesToMilliseconds(
  days: number,
  hours: number,
  minutes: number
): number {
  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}

/** Stable identity shared by reminder jobs and their message builders. */
export function getPingJobName(ping: Pick<Ping, 'time' | 'userId' | 'channelId'>): string {
  return `ping:${ping.time}:${ping.userId}:${ping.channelId}`;
}
