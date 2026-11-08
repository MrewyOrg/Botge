import { BaseDatabase, quoteIdentifier } from './base-database.ts';

type DatabaseUser = {
  readonly userId: string;
  readonly guildId: string | null;
  readonly enableEmoteBorder: number | null;
  readonly emoteBorderColor: string | null;
  readonly emoteBorderOpacity: string | null;
};
type PreferenceColumn = 'enableEmoteBorder' | 'emoteBorderColor' | 'emoteBorderOpacity';

export const DEFAULT_EMOTE_BORDER_COLOR = '000000' as const;
const SCHEMA = `CREATE TABLE IF NOT EXISTS users (
  userId TEXT NOT NULL PRIMARY KEY, guildId TEXT, enableEmoteBorder INTEGER,
  emoteBorderColor TEXT, emoteBorderOpacity TEXT
) STRICT`;
const USER_COLUMNS = 'userId, guildId, enableEmoteBorder, emoteBorderColor, emoteBorderOpacity';

export class UsersDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(filepath, SCHEMA);
  }

  public changeEnableEmoteBorder(userId: string, enableEmoteBorder: boolean): void {
    this.#changePreference(userId, 'enableEmoteBorder', Number(enableEmoteBorder));
  }
  public changeEmoteBorderColor(userId: string, emoteBorderColor: string): void {
    this.#changePreference(userId, 'emoteBorderColor', emoteBorderColor);
  }
  public changeEmoteBorderOpacity(userId: string, emoteBorderOpacity: string): void {
    this.#changePreference(userId, 'emoteBorderOpacity', emoteBorderOpacity);
  }
  public changeGuildId(userId: string, guildId: string): void {
    this.execute(
      `INSERT INTO users (userId, guildId) VALUES (?, ?)
      ON CONFLICT(userId) DO UPDATE SET guildId = excluded.guildId`,
      userId,
      guildId
    );
  }
  public getAllUsers(): readonly DatabaseUser[] {
    return this.getRows<DatabaseUser>(`SELECT ${USER_COLUMNS} FROM users`);
  }
  public getUser(userId: string): DatabaseUser | undefined {
    return this.getRow<DatabaseUser>(`SELECT ${USER_COLUMNS} FROM users WHERE userId = ?`, userId);
  }

  #changePreference(userId: string, column: PreferenceColumn, value: string | number): void {
    const identifier = quoteIdentifier(column);
    this.execute(
      `INSERT INTO users (${USER_COLUMNS}) VALUES (?, NULL, ?, ?, ?)
      ON CONFLICT(userId) DO UPDATE SET ${identifier} = excluded.${identifier}`,
      userId,
      column === 'enableEmoteBorder' ? value : 0,
      column === 'emoteBorderColor' ? value : DEFAULT_EMOTE_BORDER_COLOR,
      column === 'emoteBorderOpacity' ? value : '1.0'
    );
  }
}
