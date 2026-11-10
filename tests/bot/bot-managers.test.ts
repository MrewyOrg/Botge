import { afterEach, describe, expect, test, vi } from 'vitest';

import { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager, registerMessageBuilder } from 'src/bot/message-builder-manager.ts';
import { DATABASE_DEFINITIONS, type DatabaseInstances } from 'src/database/open-databases.ts';
import { requireValue } from 'src/utils/validation.ts';

const CLEANUP_AGE = 10 * 60_000;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Database shutdown', () => {
  test('attempts every close and reports all failures', () => {
    const firstError = new Error('first close failed');
    const secondError = new Error('second close failed');
    const databases = Object.keys(DATABASE_DEFINITIONS).map(() => ({ close: vi.fn() }));
    requireValue(databases[0], 'Expected indexed test value.').close.mockImplementation(() => {
      throw firstError;
    });
    requireValue(databases[3], 'Expected indexed test value.').close.mockImplementation(() => {
      throw secondError;
    });
    const manager = new DatabaseManager(
      Object.fromEntries(
        Object.keys(DATABASE_DEFINITIONS).map((key, index) => [key, databases[index]])
      ) as unknown as DatabaseInstances
    );

    expect(() => {
      manager.closeDatabases();
    }).toThrow(new AggregateError([firstError, secondError], 'Failed to close databases.'));
    for (const database of databases) expect(database.close).toHaveBeenCalledOnce();
  });
});

describe('Message builder cleanup', () => {
  test('removes a large expired backlog in place and preserves the age boundary', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const manager = new MessageBuilderManager();
    const builders = manager.emoteMessageBuilders;
    const expired = { interaction: { createdAt: new Date(now - CLEANUP_AGE - 1) } };
    const fresh = { interaction: { createdAt: new Date(now) } };
    const boundary = { interaction: { createdAt: new Date(now - CLEANUP_AGE) } };
    builders.push(
      ...(Array.from({ length: 20_000 }, () => expired) as unknown as typeof builders),
      fresh as unknown as (typeof builders)[number],
      boundary as unknown as (typeof builders)[number]
    );

    manager.cleanupMessageBuilders();

    expect(manager.emoteMessageBuilders).toBe(builders);
    expect(builders).toEqual([fresh, boundary]);
  });

  test('removes expired ping builders and preserves fresh ones', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const manager = new MessageBuilderManager();
    const expired = { interaction: { createdAt: new Date(now - CLEANUP_AGE - 1) } };
    const fresh = { interaction: { createdAt: new Date(now) } };
    manager.pingForPingMeMessageBuilders.push(
      ...([expired, fresh] as unknown as typeof manager.pingForPingMeMessageBuilders)
    );

    manager.cleanupMessageBuilders();

    expect(manager.pingForPingMeMessageBuilders).toEqual([fresh]);
  });
});

test('cleanup tolerates holes in a mutable builder registry', () => {
  const manager = new MessageBuilderManager();
  manager.emoteMessageBuilders.length = 2;
  expect(() => {
    manager.cleanupMessageBuilders();
  }).not.toThrow();
});

test('interactive registries retain the most recent menus under sustained traffic', () => {
  const registry: Readonly<{ id: number }>[] = [];
  for (let id = 0; id < 150; id++) registerMessageBuilder(registry, { id });
  expect(registry).toHaveLength(100);
  expect(registry[0]?.id).toBe(50);
  expect(registry.at(-1)?.id).toBe(149);
});
