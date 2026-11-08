import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { DatabaseManager } from 'src/bot/database-manager.ts';
import { AddedEmotesDatabase } from 'src/database/added-emotes-database.ts';
import { BaseDatabase } from 'src/database/base-database.ts';
import { BroadcasterNameAndPersonalEmoteSetsDatabase } from 'src/database/broadcaster-name-and-personal-emote-sets-database.ts';
import { MediaDatabase } from 'src/database/media-database.ts';
import { NamedEntriesDatabase } from 'src/database/named-entries-database.ts';
import { DATABASE_DEFINITIONS, openDatabases } from 'src/database/open-databases.ts';
import { PermittedRoleIdsDatabase } from 'src/database/permitted-role-ids-database.ts';
import { PingsDatabase } from 'src/database/pings-database.ts';
import { QuotesDatabase } from 'src/database/quotes-database.ts';
import { UsersDatabase } from 'src/database/users-database.ts';
import type { Ping } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

const opened: BaseDatabase[] = [];
function track<T extends BaseDatabase>(database: T): T {
  opened.push(database);
  return database;
}
afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  vi.restoreAllMocks();
});

const ping: Ping = {
  time: 1234,
  days: null,
  hours: 1,
  minutes: null,
  userId: 'owner',
  channelId: 'channel',
  message: 'hello',
  userIds: ['alice', 'bob'],
  userIdRemoved: true
};

describe.each(['media', 'quotes'] as const)('%s storage', (kind) => {
  test('scopes content, preserves dates, and supports rename and delete', () => {
    const db = track(
      kind === 'media' ? new MediaDatabase(':memory:') : new QuotesDatabase(':memory:')
    );
    const entry = { name: 'old', url: 'first', content: 'first', dateAdded: new Date(10) };
    const newer = { name: 'new', url: 'second', content: 'second', dateAdded: new Date(20) };
    db.insert('user', entry);
    db.insert('user', newer);
    const all = db instanceof MediaDatabase ? db.getAllMedia('user') : db.getAllQuote('user');
    expect(all.map((item) => item.name)).toEqual(['new', 'old']);
    expect(requireValue(all[0], 'Expected indexed test value.').dateAdded.getTime()).toBe(20);
    expect(db instanceof MediaDatabase ? db.getAllMedia('other') : db.getAllQuote('other')).toEqual(
      []
    );
    db.rename('user', 'first', 'renamed');
    expect(
      db instanceof MediaDatabase ?
        db.getMediaName('user', 'first')
      : db.getQuoteName('user', 'first')
    ).toBe('renamed');
    db.delete('user', { ...entry, name: 'renamed' });
    expect(
      db instanceof MediaDatabase ?
        db.mediaUrlExists('user', 'first')
      : db.quoteContentExists('user', 'first')
    ).toBe(false);
    db.delete('missing', entry);
    db.rename('missing', 'first', 'unused');
  });

  test('prefers exact names and treats SQL wildcard characters as literal text', () => {
    const db = track(
      kind === 'media' ? new MediaDatabase(':memory:') : new QuotesDatabase(':memory:')
    );
    for (const [index, name] of ['cat', 'cat videos', '100% fun', 'under_score'].entries()) {
      db.insert('user', { name, url: name, content: name, dateAdded: new Date(index) });
    }
    const find = (name: string): string | undefined =>
      db instanceof MediaDatabase ? db.getMediaUrl('user', name) : db.getQuoteContent('user', name);
    expect(find('cat')).toBe('cat');
    expect(find('CAT')).toBe('cat');
    expect(find('videos')).toBe('cat videos');
    expect(find('%')).toBe('100% fun');
    expect(find('_')).toBe('under_score');
    expect(find('no match')).toBeUndefined();
  });

  test('quotes unusual scope IDs safely and keeps scopes isolated', () => {
    const db = track(
      kind === 'media' ? new MediaDatabase(':memory:') : new QuotesDatabase(':memory:')
    );
    const scope = 'user"; DROP TABLE users; --';
    db.insert(scope, { name: 'name', url: 'value', content: 'value', dateAdded: new Date(0) });
    expect(
      db instanceof MediaDatabase ?
        db.getMediaUrl(scope, 'name')
      : db.getQuoteContent(scope, 'name')
    ).toBe('value');
    expect(
      db instanceof MediaDatabase ?
        db.getMediaUrl('user', 'name')
      : db.getQuoteContent('user', 'name')
    ).toBeUndefined();
  });
});

test('added emotes support displayed names for unaliased emotes and reject stale explicit aliases', () => {
  const db = track(new AddedEmotesDatabase(':memory:'));
  expect(db.getAll('guild')).toEqual([]);
  db.insert({ url: 'url', alias: null }, 'guild');
  // The deletion UI uses the displayed emote name even when its stored alias is null.
  db.delete({ url: 'url', alias: 'displayed name' }, 'guild');
  expect(db.getAll('guild')).toEqual([]);
  db.insert({ url: 'url', alias: null }, 'guild');
  db.delete({ url: 'url', alias: null }, 'guild');
  expect(db.getAll('guild')).toEqual([]);
  db.insert({ url: 'url', alias: 'alias' }, 'guild');
  db.delete({ url: 'url', alias: 'stale' }, 'guild');
  expect(db.getAll('guild')).toEqual([{ url: 'url', alias: 'alias' }]);
});

test('permission upserts preserve independent role lists and allow-everyone settings', () => {
  const db = track(new PermittedRoleIdsDatabase(':memory:'));
  expect(db.getSettingsPermittedRoleIds('guild')).toBeNull();
  expect(db.getAddEmotePermitNoRole('guild')).toBe(false);
  db.changeAllowEveryoneToAddEmote('guild', true);
  db.changeAddEmotePermittedRoleIds('guild', ['emote-role']);
  db.changeSettingsPermittedRoleIds('guild', ['settings-role']);
  expect(db.getAddEmotePermitNoRole('guild')).toBe(true);
  expect(db.getAddEmotePermittedRoleIds('guild')).toEqual(['emote-role']);
  expect(db.getSettingsPermittedRoleIds('guild')).toEqual(['settings-role']);
  db.changeAllowEveryoneToAddEmote('guild', false);
  expect(db.getAddEmotePermittedRoleIds('guild')).toEqual(['emote-role']);
  db.changeAddEmotePermittedRoleIds('guild', []);
  expect(db.getAddEmotePermittedRoleIds('guild')).toBeNull();
});

test('user upserts preserve unrelated preferences and guild assignments', () => {
  const db = track(new UsersDatabase(':memory:'));
  expect(db.getUser('missing')).toBeUndefined();
  db.changeGuildId('user', 'guild');
  db.changeEnableEmoteBorder('user', true);
  db.changeEmoteBorderColor('user', 'ffffff');
  db.changeEmoteBorderOpacity('user', '0.5');
  db.changeGuildId('user', 'other');
  expect(db.getUser('user')).toEqual({
    userId: 'user',
    guildId: 'other',
    enableEmoteBorder: 1,
    emoteBorderColor: 'ffffff',
    emoteBorderOpacity: '0.5'
  });
  db.changeEmoteBorderColor('new', 'aaaaaa');
  expect(db.getUser('new')).toEqual({
    userId: 'new',
    guildId: null,
    enableEmoteBorder: 0,
    emoteBorderColor: 'aaaaaa',
    emoteBorderOpacity: '1.0'
  });
});

test('broadcaster-only and missing guild settings load without constructing empty emote sets', () => {
  const db = track(new BroadcasterNameAndPersonalEmoteSetsDatabase(':memory:'));
  expect(db.getPersonalEmoteSets('missing')).toEqual([null, undefined]);
  db.changeBroadcasterName('guild', 'streamer');
  expect(db.getPersonalEmoteSets('guild')).toEqual(['streamer', undefined]);
  expect(db.getAllBroadcasterNamesAndPersonalEmoteSets().get('guild')).toEqual([
    'streamer',
    undefined
  ]);
  db.changePersonalEmoteSets('guild', { sevenTv: '7tv', bttv: null, ffz: null });
  db.changeBroadcasterName('guild', 'new-streamer');
  const [name, sets] = db.getPersonalEmoteSets('guild');
  expect(name).toBe('new-streamer');
  expect(sets?.sevenTv).toBe('7tv');
});

test('reminders round-trip recipients and owner-removal status on insert and update', () => {
  const db = track(new PingsDatabase(':memory:'));
  db.insert(ping);
  expect(db.getAll()).toEqual([ping]);
  db.updateUserIds({ ...ping, userIds: [] });
  db.updateUserIdRemoved({ ...ping, userIdRemoved: false });
  expect(db.getAll()).toEqual([{ ...ping, userIds: null, userIdRemoved: false }]);
  db.delete(ping);
  db.updateUserIds(ping);
  expect(db.getAll()).toEqual([]);
});

test('existing on-disk media tables remain readable after the refactor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-db-legacy-'));
  try {
    const path = join(directory, 'media.sqlite');
    const original = new DatabaseSync(path);
    original.exec(
      "CREATE TABLE media_123 (name TEXT NOT NULL PRIMARY KEY, url TEXT NOT NULL, dateAdded INTEGER NOT NULL) STRICT; INSERT INTO media_123 VALUES ('legacy', 'https://example.com', 1234)"
    );
    original.close();
    const db = new MediaDatabase(path);
    try {
      expect(db.getAllMedia('123')).toEqual([
        { name: 'legacy', url: 'https://example.com', dateAdded: new Date(1234) }
      ]);
    } finally {
      db.close();
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the registry opens every database with the existing filenames and the manager closes them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-db-registry-'));
  try {
    const databases = openDatabases(join(directory, 'new-directory'));
    const manager = new DatabaseManager(databases);
    expect(Object.keys(manager.databases)).toEqual(Object.keys(DATABASE_DEFINITIONS));
    expect(manager.mediaDatabase).toBe(databases.mediaDatabase);
    manager.usersDatabase.changeGuildId('user', 'guild');
    manager.closeDatabases();
    manager.closeDatabases();
    const reopened = new UsersDatabase(join(directory, 'new-directory', 'users.sqlite'));
    try {
      expect(reopened.getUser('user')?.guildId).toBe('guild');
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed initialization closes already-opened databases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-db-failure-'));
  try {
    await writeFile(join(directory, 'users.sqlite'), 'not a SQLite database');
    const close = vi.spyOn(BaseDatabase.prototype, 'close');
    expect(() => openDatabases(directory)).toThrow();
    expect(close).toHaveBeenCalledTimes(Object.keys(DATABASE_DEFINITIONS).length - 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class NotesDatabase extends NamedEntriesDatabase {
  public constructor(filepath: string) {
    super(filepath, 'notes', 'body');
  }
  public save(userId: string, name: string, body: string): void {
    this.insertEntry(userId, { name, value: body, dateAdded: new Date(0) });
  }
  public find(userId: string, name: string): string | undefined {
    return this.findEntryValue(userId, name);
  }
}

test('the named-entry base supports a new collection with its own value column', () => {
  const db = track(new NotesDatabase(':memory:'));
  db.save('user', 'shopping', 'milk');
  expect(db.find('user', 'shopping')).toBe('milk');
  expect(db.find('other', 'shopping')).toBeUndefined();
});

test('deleting and renaming in absent scopes are harmless', () => {
  const media = new MediaDatabase(':memory:');
  const added = new AddedEmotesDatabase(':memory:');
  try {
    media.rename('missing', 'url', 'new');
    media.delete('missing', { name: 'name', url: 'url' });
    expect(media.getMediaName('missing', 'url')).toBeUndefined();
    expect(media.mediaNameExists('missing', 'name')).toBe(false);
    expect(media.mediaUrlExists('missing', 'url')).toBe(false);
    added.delete({ url: 'url', alias: null }, 'missing');
    expect(added.getAll('missing')).toEqual([]);
  } finally {
    media.close();
    added.close();
  }
});

test('opening failures aggregate cleanup errors after closing the connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-db-close-failure-'));
  const close = vi
    .spyOn(DATABASE_DEFINITIONS.broadcasterNameAndPersonalEmoteSetsDatabase, 'create')
    .mockReturnValue({
      close: (): void => {
        throw new Error('cleanup failed');
      }
    } as unknown as ReturnType<
      typeof DATABASE_DEFINITIONS.broadcasterNameAndPersonalEmoteSetsDatabase.create
    >);
  try {
    await writeFile(join(directory, 'users.sqlite'), 'invalid database');
    expect(() => openDatabases(directory)).toThrow(AggregateError);
  } finally {
    close.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
