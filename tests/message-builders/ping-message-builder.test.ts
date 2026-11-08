import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  TextChannel
} from 'discord.js';
import { type Job, scheduledJobs as schedulerJobs } from 'node-schedule';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager } from 'src/bot/message-builder-manager.ts';
import { getPingJobName } from 'src/bot/ping-utils.ts';
import { registerPings } from 'src/bot/register-pings.ts';
import { PingsDatabase } from 'src/database/pings-database.ts';
import type { Guild } from 'src/discord/guild.ts';
import { buttonHandler } from 'src/handlers/interactions/button.ts';
import { getCustomId } from 'src/message-builders/base.ts';
import { PingForPingListMessageBuilder } from 'src/message-builders/ping-for-ping-list-message-builder.ts';
import {
  DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
  PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
  PingForPingMeMessageBuilder,
  REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID
} from 'src/message-builders/ping-for-ping-me-message-builder.ts';
import type { Ping } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

let database: PingsDatabase;
let jobs: Readonly<Job>[];
const send = vi.fn();
const editReply = vi.fn().mockResolvedValue(undefined);
const interaction = { user: { id: 'owner' }, editReply } as unknown as ChatInputCommandInteraction;
const channel = { send, isSendable: (): boolean => true } as unknown as TextChannel;

function createBuilder(ping: Ping, listView = false): PingForPingMeMessageBuilder {
  return new PingForPingMeMessageBuilder(
    interaction,
    ping,
    new Date(ping.time + 600_000),
    channel,
    jobs,
    listView ?
      PingForPingMeMessageBuilder.messageBuilderTypeForPingList
    : PingForPingMeMessageBuilder.messageBuilderTypeForPingMe
  );
}
function createPing(userId = 'owner'): Ping {
  return {
    time: Date.now(),
    days: null,
    hours: null,
    minutes: 10,
    userId,
    channelId: 'channel',
    message: null,
    userIds: null,
    userIdRemoved: null
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  editReply.mockClear();
  database = new PingsDatabase(':memory:');
  jobs = [];
  send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  for (const job of Object.values(schedulerJobs)) job.cancel();
  database.close();
  vi.useRealTimers();
});

describe('Reminder scheduling', () => {
  test('separate reminders at the same instant get separate jobs and both fire', async () => {
    const first = createBuilder(createPing('first'));
    const second = createBuilder(createPing('second'));
    expect(first.registerPing(database)).toBeDefined();
    expect(second.registerPing(database)).toBeDefined();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job: Readonly<Pick<Job, 'name'>>) => job.name)).toEqual([
      getPingJobName(first.ping),
      getPingJobName(second.ping)
    ]);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.flat().join(' ')).toContain('<@first>');
    expect(send.mock.calls.flat().join(' ')).toContain('<@second>');
    expect(database.getAll()).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test('different views share current recipients without rescheduling or losing updates', async () => {
    const ping = createPing();
    const first = createBuilder(ping);
    first.registerPing(database);
    const second = createBuilder(
      requireValue(database.getAll()[0], 'Expected indexed test value.'),
      true
    );
    second.registerPing(database);
    first.addUserId(database, 'alice');
    second.addUserId(database, 'bob');
    expect(jobs).toHaveLength(1);
    expect(requireValue(database.getAll()[0], 'Expected indexed test value.').userIds).toEqual([
      'alice',
      'bob'
    ]);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(send).toHaveBeenCalledOnce();
    expect(requireValue(send.mock.calls[0], 'Expected indexed test value.')[0]).toContain(
      '<@alice>, <@bob>'
    );
    expect(jobs).toEqual([]);
  });

  test('deletion cancels and removes the job and stale views cannot resurrect it', () => {
    const first = createBuilder(createPing());
    first.registerPing(database);
    const stale = createBuilder(
      requireValue(database.getAll()[0], 'Expected indexed test value.'),
      true
    );
    stale.registerPing(database);
    expect(first.deletePing(database).deletionEvent).toBe(true);
    expect(jobs).toEqual([]);
    expect(database.getAll()).toEqual([]);
    expect(stale.addUserId(database, 'alice').reply).toBeUndefined();
    expect(stale.deletePing(database).deletionEvent).toBe(false);
    const newView = createBuilder(first.ping, true);
    expect(newView.registerPing(database)).toBeUndefined();
    expect(database.getAll()).toEqual([]);
  });

  test('cooldowns expire on access without creating recurring cleanup jobs', async () => {
    const builder = createBuilder(createPing());
    builder.registerPing(database);
    builder.addUserId(database, 'alice');
    builder.removeUserId(database, 'alice');
    expect(builder.addUserId(database, 'alice').buttonReply).toContain('Please wait');
    expect(Object.keys(schedulerJobs)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(builder.addUserId(database, 'alice').reply).toBeDefined();
    expect(jobs).toHaveLength(1);
  });

  test('invalid reminder dates fail before scheduling or inserting data', () => {
    expect(
      () =>
        new PingForPingMeMessageBuilder(
          interaction,
          createPing(),
          new Date(NaN),
          channel,
          jobs,
          PingForPingMeMessageBuilder.messageBuilderTypeForPingMe
        )
    ).toThrow('Invalid ping date.');
    expect(database.getAll()).toEqual([]);
    expect(jobs).toEqual([]);
  });

  test('failed persistence never leaves a scheduled reminder', () => {
    const builder = createBuilder(createPing());
    vi.spyOn(database, 'insert').mockImplementationOnce(() => {
      throw new Error('Insert failed');
    });
    expect(() => {
      builder.registerPing(database);
    }).toThrow('Insert failed');
    expect(jobs).toEqual([]);
  });
  test('restored reminders share identity and deliver updated recipients', async () => {
    const ping = createPing();
    database.insert(ping);
    const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as unknown as Client;
    await registerPings(client, database, jobs);
    const builder = createBuilder(ping, true);
    expect(builder.registerPing(database)).toBeDefined();
    expect(builder.addUserId(database, 'alice').reply).toBeDefined();
    expect(jobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(send).toHaveBeenCalledOnce();
    expect(requireValue(send.mock.calls[0], 'Expected indexed test value.')[0]).toContain(
      '<@alice>'
    );
    expect(jobs).toEqual([]);
    expect(database.getAll()).toEqual([]);
  });

  test('recipient additions stop before the reminder exceeds Discord message limits', () => {
    const builder = createBuilder({ ...createPing(), message: 'x'.repeat(1800) });
    builder.registerPing(database);
    let rejected = false;
    for (let index = 0; index < 100; index++) {
      const result = builder.addUserId(database, `1234567890123456${index}`);
      if (result.buttonReply !== undefined) {
        rejected = true;
        break;
      }
      expect(result.reply?.content.length).toBeLessThanOrEqual(2000);
    }
    expect(rejected).toBe(true);
    expect(jobs).toHaveLength(1);
  });
});

test.each(['fetch', 'send'])(
  'one inaccessible reminder does not prevent restoring the rest: %s',
  async (failure) => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = { ...createPing('first'), time: Date.now() - 700_000 };
    const second = createPing('second');
    database.insert(first);
    database.insert(second);
    const fetch = vi.fn().mockResolvedValue(channel);
    if (failure === 'fetch') fetch.mockRejectedValueOnce(new Error('Channel unavailable'));
    else send.mockRejectedValueOnce(new Error('Missing permission'));
    try {
      await registerPings({ channels: { fetch } } as unknown as Client, database, jobs);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(jobs).toHaveLength(1);
      expect(requireValue(jobs[0], 'Expected indexed test value.').name).toBe(
        getPingJobName(second)
      );
      expect(database.getAll()).toHaveLength(2);
    } finally {
      errorLog.mockRestore();
    }
  }
);

test('reminder buttons subscribe and unsubscribe a recipient through persisted state', async () => {
  const builder = createBuilder(createPing());
  builder.registerPing(database);
  const manager = new MessageBuilderManager();
  manager.pingForPingMeMessageBuilders.push(builder);
  const handle = buttonHandler(
    {} as Client,
    { id: 'guild' } as Readonly<Guild>,
    undefined,
    manager,
    { pingsDatabase: database } as unknown as DatabaseManager
  );
  for (const action of [
    PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
    REMOVE_ME_FROM_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID
  ]) {
    const event = {
      customId: getCustomId(
        action,
        PingForPingMeMessageBuilder.messageBuilderTypeForPingMe,
        builder.counter
      ),
      user: { id: 'other' },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined)
    };
    await handle(event as unknown as ButtonInteraction);
    expect(event.deferUpdate).toHaveBeenCalledOnce();
    expect(database.getAll()[0]?.userIds ?? []).toEqual(
      action === PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID ? ['other'] : []
    );
  }
  expect(editReply).toHaveBeenCalledTimes(2);
});

test.each(['owner', 'other'])(
  'only the reminder owner can delete it using a button: %s',
  async (userId) => {
    const builder = createBuilder(createPing());
    builder.registerPing(database);
    const manager = new MessageBuilderManager();
    manager.pingForPingMeMessageBuilders.push(builder);
    const event = {
      customId: getCustomId(
        DELETE_PING_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
        PingForPingMeMessageBuilder.messageBuilderTypeForPingMe,
        builder.counter
      ),
      user: { id: userId },
      deferUpdate: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined)
    };
    await buttonHandler({} as Client, { id: 'guild' } as Readonly<Guild>, undefined, manager, {
      pingsDatabase: database
    } as unknown as DatabaseManager)(event as unknown as ButtonInteraction);
    expect(database.getAll()).toHaveLength(userId === 'owner' ? 0 : 1);
    expect(manager.pingForPingMeMessageBuilders).toHaveLength(userId === 'owner' ? 0 : 1);
    expect(jobs).toHaveLength(userId === 'owner' ? 0 : 1);
  }
);

test.each([30_000, 65 * 60_000])(
  'overdue reminders report their delay and are removed after delivery: %s',
  async (delay) => {
    const ping = {
      ...createPing(),
      time: Date.now() - delay,
      minutes: null,
      hours: null,
      days: null
    };
    database.insert(ping);
    await registerPings(
      { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as unknown as Client,
      database,
      jobs
    );
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining(delay < 60_000 ? 'less than a minute' : '1 hours and 5 minute')
    );
    expect(database.getAll()).toEqual([]);
  }
);

test('restored reminders deleted before delivery do not send', async () => {
  const ping = createPing();
  database.insert(ping);
  await registerPings(
    { channels: { fetch: vi.fn().mockResolvedValue(channel) } } as unknown as Client,
    database,
    jobs
  );
  database.delete(ping);
  await vi.advanceTimersByTimeAsync(600_001);
  expect(send).not.toHaveBeenCalled();
  expect(jobs).toEqual([]);
});

test('unavailable restored reminder channels retain stored reminders without scheduling', async () => {
  database.insert(createPing());
  await registerPings(
    { channels: { fetch: vi.fn().mockResolvedValue(null) } } as unknown as Client,
    database,
    jobs
  );
  expect(database.getAll()).toHaveLength(1);
  expect(jobs).toEqual([]);
});

test('owners can leave shared reminders and rejoin without deleting other recipients', () => {
  const builder = createBuilder(createPing());
  builder.registerPing(database);
  expect(builder.addUserId(database, 'owner').reply).toBeUndefined();
  expect(builder.removeUserId(database, 'owner').buttonReply).toBeDefined();
  expect(builder.removeUserId(database, 'stranger').reply).toBeUndefined();
  builder.addUserId(database, 'alice');
  expect(builder.deletePing(database).buttonReply).toContain('cannot delete');
  expect(builder.removeUserId(database, 'owner').reply).toBeDefined();
  expect(database.getAll()[0]?.userIdRemoved).toBe(true);
  expect(builder.removeUserId(database, 'owner').buttonReply).toContain('Please wait');
  expect(builder.addUserId(database, 'owner').reply).toBeDefined();
  expect(database.getAll()[0]?.userIdRemoved).toBe(false);
  const view = createBuilder(requireValue(database.getAll()[0], 'Expected reminder.'), true);
  view.registerPing(database);
  expect(view.addUserId(database, 'alice').reply).toBeUndefined();
  expect(view.removeUserId(database, 'stranger').reply).toBeUndefined();
  expect(builder.row.toJSON().components.length).toBe(3);
});

test('the last remaining recipient leaving deletes a reminder whose owner has left', () => {
  const builder = createBuilder(createPing());
  builder.registerPing(database);
  builder.addUserId(database, 'alice');
  builder.removeUserId(database, 'owner');
  expect(builder.removeUserId(database, 'alice').deletionEvent).toBe(true);
  expect(database.getAll()).toEqual([]);
  expect(jobs).toEqual([]);
});

test('critical-time reminder controls cannot modify persistence or scheduling', () => {
  const ping = createPing();
  const builder = createBuilder(ping);
  builder.registerPing(database);
  expect(builder.registerPing(database)).toBeUndefined();
  vi.setSystemTime(ping.time + 590_000);
  expect(builder.registerPing(database)).toBeUndefined();
  expect(builder.addUserId(database, 'other').reply).toBeUndefined();
  expect(builder.removeUserId(database, 'owner').reply).toBeUndefined();
  expect(builder.deletePing(database).deletionEvent).toBe(false);
  expect(database.getAll()).toHaveLength(1);
  expect(jobs).toHaveLength(1);
});

test('reminder controls in a list find the displayed reminder rather than the list counter', async () => {
  let builder = createBuilder(createPing());
  let list = new PingForPingListMessageBuilder(interaction, [builder], undefined);
  if (list.counter === builder.counter) {
    createBuilder(createPing());
    builder = createBuilder(createPing());
    list = new PingForPingListMessageBuilder(interaction, [builder], undefined);
  }
  expect(list.counter).not.toBe(builder.counter);
  builder.registerPing(database);
  list.first();
  const manager = new MessageBuilderManager();
  manager.pingForPingListMessageBuilders.push(list);
  const event = {
    customId: getCustomId(
      PING_ME_AS_WELL_BUTTON_FOR_PING_ME_BASE_CUSTOM_ID,
      PingForPingMeMessageBuilder.messageBuilderTypeForPingList,
      builder.counter
    ),
    user: { id: 'other' },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined)
  };
  const handle = buttonHandler({} as Client, {} as Guild, undefined, manager, {
    pingsDatabase: database
  } as unknown as DatabaseManager);
  await handle(event as unknown as ButtonInteraction);
  expect(database.getAll()[0]?.userIds).toEqual(['other']);
  await handle(event as unknown as ButtonInteraction);
  expect(event.reply).toHaveBeenCalledOnce();
});

test('reminder interactions and delivery use indexed reads rather than loading every stored reminder', async () => {
  const builder = createBuilder(createPing());
  builder.registerPing(database);
  const scan = vi.spyOn(database, 'getAll');
  try {
    builder.addUserId(database, 'other');
    await vi.advanceTimersByTimeAsync(600_001);
    expect(scan).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  } finally {
    scan.mockRestore();
  }
});

test.each([true, false])(
  'scheduled delivery fetches current channel state rather than retaining its creation snapshot: %s',
  async (available) => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValue(available ? { isSendable: (): boolean => true, send: deliver } : null);
    const ping = createPing();
    const builder = new PingForPingMeMessageBuilder(
      interaction,
      ping,
      new Date(ping.time + 600_000),
      channel,
      jobs,
      PingForPingMeMessageBuilder.messageBuilderTypeForPingMe,
      { channels: { fetch } } as unknown as Client
    );
    builder.registerPing(database);
    await vi.advanceTimersByTimeAsync(600_001);
    expect(fetch).toHaveBeenCalledWith('channel');
    expect(send).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(available ? 1 : 0);
    expect(database.getAll()).toHaveLength(available ? 0 : 1);
  }
);

test('restored jobs re-check channel availability when they run', async () => {
  const ping = createPing();
  database.insert(ping);
  const fetch = vi.fn().mockResolvedValueOnce(channel).mockResolvedValueOnce(null);
  await registerPings({ channels: { fetch } } as unknown as Client, database, jobs);
  await vi.advanceTimersByTimeAsync(600_001);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(send).not.toHaveBeenCalled();
  expect(database.getAll()).toHaveLength(1);
});
