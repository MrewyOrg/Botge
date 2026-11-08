import type { Ping } from '../types.ts';
import { BaseDatabase } from './base-database.ts';
import { deserializeIds, serializeIds } from './id-list.ts';

type DatabasePing = Omit<Ping, 'userIds' | 'userIdRemoved'> & {
  readonly userIds: string | null;
  readonly userIdRemoved: number | null;
};

function deserializePing(ping: DatabasePing): Ping {
  return {
    ...ping,
    userIds: deserializeIds(ping.userIds),
    userIdRemoved: ping.userIdRemoved === null ? null : Boolean(ping.userIdRemoved)
  };
}

function getId(ping: Pick<Ping, 'time' | 'userId' | 'channelId'>): string {
  return `${ping.time}_${ping.userId}_${ping.channelId}`;
}
const SCHEMA = `CREATE TABLE IF NOT EXISTS pings (
  id TEXT NOT NULL PRIMARY KEY, time INTEGER NOT NULL, days INTEGER, hours INTEGER, minutes INTEGER,
  userId TEXT NOT NULL, channelId TEXT NOT NULL, message TEXT, userIds TEXT, userIdRemoved INTEGER
) STRICT`;

export class PingsDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(filepath, SCHEMA);
  }

  public insert(ping: Ping): void {
    this.execute(
      `INSERT INTO pings (id, time, days, hours, minutes, userId, channelId, message, userIds, userIdRemoved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      getId(ping),
      ping.time,
      ping.days,
      ping.hours,
      ping.minutes,
      ping.userId,
      ping.channelId,
      ping.message,
      serializeIds(ping.userIds),
      ping.userIdRemoved === null ? null : Number(ping.userIdRemoved)
    );
  }
  public delete(ping: Ping): void {
    this.execute('DELETE FROM pings WHERE id = ?', getId(ping));
  }
  public updateUserIds(ping: Ping): void {
    this.execute(
      'UPDATE pings SET userIds = ? WHERE id = ?',
      serializeIds(ping.userIds),
      getId(ping)
    );
  }
  public updateUserIdRemoved(ping: Ping): void {
    this.execute(
      'UPDATE pings SET userIdRemoved = ? WHERE id = ?',
      ping.userIdRemoved === null ? null : Number(ping.userIdRemoved),
      getId(ping)
    );
  }
  public get(ping: Pick<Ping, 'time' | 'userId' | 'channelId'>): Ping | undefined {
    const row = this.getRow<DatabasePing>(
      'SELECT time, days, hours, minutes, userId, channelId, message, userIds, userIdRemoved FROM pings WHERE id = ?',
      getId(ping)
    );
    return row === undefined ? undefined : deserializePing(row);
  }

  public getAll(): readonly Ping[] {
    return this.getRows<DatabasePing>(
      'SELECT time, days, hours, minutes, userId, channelId, message, userIds, userIdRemoved FROM pings'
    ).map(deserializePing);
  }
}
