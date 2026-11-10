import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { AddedEmotesDatabase } from './added-emotes-database.ts';
import type { BaseDatabase } from './base-database.ts';
import { BroadcasterNameAndPersonalEmoteSetsDatabase } from './broadcaster-name-and-personal-emote-sets-database.ts';
import { MediaDatabase } from './media-database.ts';
import { PermittedRoleIdsDatabase } from './permitted-role-ids-database.ts';
import { PingsDatabase } from './pings-database.ts';
import { QuotesDatabase } from './quotes-database.ts';
import { UsersDatabase } from './users-database.ts';
import { VoiceChannelsDatabase } from './voice-channels-database.ts';

/** Add new database files here; opening and shutdown use this registry automatically. */
export const DATABASE_DEFINITIONS = {
  broadcasterNameAndPersonalEmoteSetsDatabase: {
    filename: 'broadcasterNameAndPersonalEmoteSets.sqlite',
    create: (filepath: string): BroadcasterNameAndPersonalEmoteSetsDatabase =>
      new BroadcasterNameAndPersonalEmoteSetsDatabase(filepath)
  },
  permittedRoleIdsDatabase: {
    filename: 'permitRoleIds.sqlite',
    create: (filepath: string): PermittedRoleIdsDatabase => new PermittedRoleIdsDatabase(filepath)
  },
  addedEmotesDatabase: {
    filename: 'addedEmotes.sqlite',
    create: (filepath: string): AddedEmotesDatabase => new AddedEmotesDatabase(filepath)
  },
  mediaDatabase: {
    filename: 'media.sqlite',
    create: (filepath: string): MediaDatabase => new MediaDatabase(filepath)
  },
  quoteDatabase: {
    filename: 'quote.sqlite',
    create: (filepath: string): QuotesDatabase => new QuotesDatabase(filepath)
  },
  pingsDatabase: {
    filename: 'pings.sqlite',
    create: (filepath: string): PingsDatabase => new PingsDatabase(filepath)
  },
  voiceChannelsDatabase: {
    filename: 'voiceChannels.sqlite',
    create: (filepath: string): VoiceChannelsDatabase => new VoiceChannelsDatabase(filepath)
  },
  usersDatabase: {
    filename: 'users.sqlite',
    create: (filepath: string): UsersDatabase => new UsersDatabase(filepath)
  }
} as const;

export type DatabaseInstances = {
  readonly [Key in keyof typeof DATABASE_DEFINITIONS]: Readonly<
    ReturnType<(typeof DATABASE_DEFINITIONS)[Key]['create']>
  >;
};

export function openDatabases(directory: string): DatabaseInstances {
  mkdirSync(directory, { recursive: true });
  const opened: [string, BaseDatabase][] = [];
  try {
    for (const [key, definition] of Object.entries(DATABASE_DEFINITIONS)) {
      opened.push([key, definition.create(join(directory, definition.filename))]);
    }
    return Object.fromEntries(opened) as unknown as DatabaseInstances;
  } catch (error) {
    const errors: unknown[] = [error];
    for (const [, database] of opened) {
      try {
        database.close();
      } catch (closeError) {
        errors.push(closeError);
      }
    }
    if (errors.length > 1)
      throw new AggregateError(errors, 'Failed to open databases and clean up connections.', {
        cause: error
      });
    throw error;
  }
}
