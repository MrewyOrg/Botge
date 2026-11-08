import { type ChatInputCommandInteraction, type Client, Collection } from 'discord.js';
import { type Job, scheduledJobs } from 'node-schedule';
import { afterEach, beforeEach, expect, type Mock, test, vi } from 'vitest';

import { PingsDatabase } from 'src/database/pings-database.ts';
import { pingListHandler } from 'src/handlers/commands/ping-list.ts';
import { pingMeHandler } from 'src/handlers/commands/ping-me.ts';
import type { PingForPingListMessageBuilder } from 'src/message-builders/ping-for-ping-list-message-builder.ts';
import type { PingForPingMeMessageBuilder } from 'src/message-builders/ping-for-ping-me-message-builder.ts';

let database: PingsDatabase;
let jobs: Readonly<Job>[];
let builders: Readonly<PingForPingMeMessageBuilder>[];

function target(
  values: Readonly<Record<string, string | number>> = {},
  direct = false
): Readonly<{ value: ChatInputCommandInteraction; editReply: Mock }> {
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    editReply,
    value: {
      user: { id: 'owner' },
      channelId: 'channel',
      guild:
        direct ? null : (
          {
            channels: { cache: new Collection([['channel', { id: 'channel', name: 'general' }]]) },
            members: {
              cache: new Collection([
                ['bot', { id: 'bot', displayName: 'Bot' }],
                ['owner', { id: 'owner', displayName: 'Owner' }]
              ])
            }
          }
        ),
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply,
      options: {
        get: (name: string): Readonly<{ value: string | number }> | null => {
          const value = values[name];
          return value === undefined ? null : { value };
        }
      }
    } as unknown as ChatInputCommandInteraction
  };
}

function client(mode = 'text'): Client {
  return {
    user: { id: 'bot' },
    channels: {
      cache: new Map(
        mode === 'missing' ?
          []
        : [
            [
              'channel',
              {
                isTextBased: (): boolean => mode !== 'voice',
                isDMBased: (): boolean => mode === 'dm',
                isSendable: (): boolean => true,
                send: vi.fn().mockResolvedValue(undefined),
                permissionsFor: (): Readonly<{ has: () => boolean }> => ({
                  has: (): boolean => mode !== 'denied'
                })
              }
            ]
          ]
      )
    }
  } as unknown as Client;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  database = new PingsDatabase(':memory:');
  jobs = [];
  builders = [];
});
afterEach(() => {
  for (const job of Object.values(scheduledJobs)) job.cancel();
  database.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  [{}, 'Either days, hours or minutes must be specified.'],
  [{ days: 0 }, 'Days must be at least 1.'],
  [{ hours: -1 }, 'Hours must be at least 1.'],
  [{ minutes: 0 }, 'Minutes must be at least 1.'],
  [{ minutes: 1, message: 'x'.repeat(1801) }, 'Message must be at most 1800 characters.']
] as const)('invalid reminder options never persist or schedule: %j', async (values, message) => {
  const interaction = target(values);
  await pingMeHandler(database, builders, client(), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(message);
  expect(database.getAll()).toEqual([]);
  expect(jobs).toEqual([]);
  expect(builders).toEqual([]);
});

test('direct messages cannot register reminders', async () => {
  const interaction = target({ minutes: 1 }, true);
  await pingMeHandler(database, builders, client(), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(
    'The bot had to have been added as a server bot for this command to work.'
  );
  expect(database.getAll()).toEqual([]);
});

test.each(['missing', 'voice', 'dm'])('reminders reject a %s channel', async (mode) => {
  const interaction = target({ minutes: 1 });
  await pingMeHandler(database, builders, client(mode), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(
    'The command can only be used in a text channel.'
  );
  expect(database.getAll()).toEqual([]);
});

test('reminders require permission to send to the channel', async () => {
  const interaction = target({ minutes: 1 });
  await pingMeHandler(database, builders, client('denied'), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(
    expect.stringContaining('does not have the permissions')
  );
  expect(database.getAll()).toEqual([]);
  expect(jobs).toEqual([]);
});

test('valid reminders persist their owner, duration and message and schedule exactly one job', async () => {
  const interaction = target({ days: 1, hours: 2, minutes: 3, message: 'remember this' });
  await pingMeHandler(database, builders, client(), jobs)(interaction.value);
  expect(database.getAll()).toEqual([
    expect.objectContaining({
      userId: 'owner',
      channelId: 'channel',
      days: 1,
      hours: 2,
      minutes: 3,
      message: 'remember this'
    })
  ]);
  expect(jobs).toHaveLength(1);
  expect(builders).toHaveLength(1);
  expect(jobs[0]?.nextInvocation()?.getTime()).toBe(Date.now() + (26 * 60 + 3) * 60_000);
  expect(interaction.editReply).toHaveBeenCalled();
});

test.each(['own', 'every'])('reminder lists filter by server and ownership: %s', async (type) => {
  const interaction = target({ type });
  for (const userId of ['owner', 'other'])
    database.insert({
      time: Date.now(),
      userId,
      channelId: 'channel',
      days: null,
      hours: null,
      minutes: 10,
      message: 'test',
      userIds: null,
      userIdRemoved: null
    });
  database.insert({
    time: Date.now(),
    userId: 'owner',
    channelId: 'elsewhere',
    days: null,
    hours: null,
    minutes: 10,
    message: 'test',
    userIds: null,
    userIdRemoved: null
  });
  const lists: Readonly<PingForPingListMessageBuilder>[] = [];
  await pingListHandler(database, lists, client(), jobs)(interaction.value);
  expect(lists).toHaveLength(1);
  expect(jobs).toEqual([]);
  expect(lists[0]?.next() === undefined).toBe(type === 'own');
  expect(database.getAll()).toHaveLength(3);
  expect(interaction.editReply).toHaveBeenCalledOnce();
});

test.each(['own', 'every'])('empty reminder lists give feedback: %s', async (type) => {
  const interaction = target({ type });
  await pingListHandler(database, [], client(), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(
    type === 'own' ?
      "You didn't register any pings yet."
    : 'There are no pings registered for this server.'
  );
});

test('reminder lists in direct messages do not expose server reminders', async () => {
  const interaction = target({ type: 'own' }, true);
  await pingListHandler(database, [], client(), jobs)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith("You didn't register any pings yet.");
});
