import type { PersonalEmoteSets } from '../emotes/personal-emote-sets.ts';
import { BaseDatabase } from './base-database.ts';

type StoredEmoteSets = {
  readonly guildId: string;
  readonly broadcasterName: string | null;
  readonly sevenTv: string | null;
  readonly bttv: string | null;
  readonly ffz: string | null;
};
type GuildEmoteSettings = readonly [string | null, PersonalEmoteSets | undefined];

const SCHEMA = `CREATE TABLE IF NOT EXISTS assignedEmoteSets (
  guildId TEXT NOT NULL PRIMARY KEY, broadcasterName TEXT, sevenTv TEXT, bttv TEXT, ffz TEXT
) STRICT`;

function toSettings(row: StoredEmoteSets): GuildEmoteSettings {
  const { broadcasterName, sevenTv, bttv, ffz } = row;
  return [
    broadcasterName,
    sevenTv === null && bttv === null && ffz === null ? undefined : { sevenTv, bttv, ffz }
  ];
}

export class BroadcasterNameAndPersonalEmoteSetsDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(filepath, SCHEMA);
  }

  public changePersonalEmoteSets(guildId: string, personalEmoteSets: PersonalEmoteSets): void {
    this.execute(
      `INSERT INTO assignedEmoteSets (guildId, sevenTv, bttv, ffz) VALUES (?, ?, ?, ?)
      ON CONFLICT(guildId) DO UPDATE SET sevenTv = excluded.sevenTv, bttv = excluded.bttv, ffz = excluded.ffz`,
      guildId,
      personalEmoteSets.sevenTv,
      personalEmoteSets.bttv,
      personalEmoteSets.ffz
    );
  }
  public changeBroadcasterName(guildId: string, broadcasterName: string): void {
    this.execute(
      `INSERT INTO assignedEmoteSets (guildId, broadcasterName) VALUES (?, ?)
      ON CONFLICT(guildId) DO UPDATE SET broadcasterName = excluded.broadcasterName`,
      guildId,
      broadcasterName
    );
  }
  public getPersonalEmoteSets(guildId: string): GuildEmoteSettings {
    const row = this.getRow<StoredEmoteSets>(
      'SELECT guildId, broadcasterName, sevenTv, bttv, ffz FROM assignedEmoteSets WHERE guildId = ?',
      guildId
    );
    return row === undefined ? [null, undefined] : toSettings(row);
  }
  public getAllBroadcasterNamesAndPersonalEmoteSets(): ReadonlyMap<string, GuildEmoteSettings> {
    return new Map(
      this.getRows<StoredEmoteSets>(
        'SELECT guildId, broadcasterName, sevenTv, bttv, ffz FROM assignedEmoteSets'
      ).map((row) => [row.guildId, toSettings(row)])
    );
  }
}
