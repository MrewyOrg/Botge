import { deserializeIds, serializeIds } from './id-list.ts';
import { ScopedDatabase } from './scoped-database.ts';

const SETTINGS_ID_TYPE = 'settingsType' as const;
const ADD_EMOTE_ID_TYPE = 'addEmoteType' as const;

export class PermittedRoleIdsDatabase extends ScopedDatabase {
  public constructor(filepath: string) {
    super(
      filepath,
      'settingsPermittedRoleIds',
      'idType TEXT NOT NULL PRIMARY KEY, roleIds TEXT, permitNoRole INTEGER NOT NULL'
    );
  }
  public changeSettingsPermittedRoleIds(guildId: string, roleIds: readonly string[]): void {
    this.#changeRoleIds(guildId, SETTINGS_ID_TYPE, roleIds);
  }
  public changeAddEmotePermittedRoleIds(guildId: string, roleIds: readonly string[]): void {
    this.#changeRoleIds(guildId, ADD_EMOTE_ID_TYPE, roleIds);
  }
  public saveAddEmoteAccess(guildId: string, roleIds: readonly string[], everyone: boolean): void {
    this.ensureTable(guildId);
    this.execute(
      `INSERT INTO ${this.tableName(guildId)} (idType, roleIds, permitNoRole) VALUES (?, ?, ?)
      ON CONFLICT(idType) DO UPDATE SET roleIds = excluded.roleIds, permitNoRole = excluded.permitNoRole`,
      ADD_EMOTE_ID_TYPE,
      serializeIds(roleIds),
      Number(everyone)
    );
  }
  public changeAllowEveryoneToAddEmote(guildId: string, permitNoRole: boolean): void {
    this.ensureTable(guildId);
    this.execute(
      `INSERT INTO ${this.tableName(guildId)} (idType, roleIds, permitNoRole) VALUES (?, NULL, ?)
      ON CONFLICT(idType) DO UPDATE SET permitNoRole = excluded.permitNoRole`,
      ADD_EMOTE_ID_TYPE,
      Number(permitNoRole)
    );
  }
  public getSettingsPermittedRoleIds(guildId: string): readonly string[] | null {
    return this.#getRoleIds(guildId, SETTINGS_ID_TYPE);
  }
  public getAddEmotePermittedRoleIds(guildId: string): readonly string[] | null {
    return this.#getRoleIds(guildId, ADD_EMOTE_ID_TYPE);
  }
  public getAddEmotePermitNoRole(guildId: string): boolean {
    if (!this.scopeExists(guildId)) return false;
    return Boolean(
      this.getRow<{ readonly permitNoRole: number }>(
        `SELECT permitNoRole FROM ${this.tableName(guildId)} WHERE idType = ?`,
        ADD_EMOTE_ID_TYPE
      )?.permitNoRole
    );
  }
  public createTable(guildId: string): void {
    this.ensureTable(guildId);
  }

  #changeRoleIds(guildId: string, idType: string, roleIds: readonly string[]): void {
    this.ensureTable(guildId);
    this.execute(
      `INSERT INTO ${this.tableName(guildId)} (idType, roleIds, permitNoRole) VALUES (?, ?, 0)
      ON CONFLICT(idType) DO UPDATE SET roleIds = excluded.roleIds`,
      idType,
      serializeIds(roleIds)
    );
  }
  #getRoleIds(guildId: string, idType: string): readonly string[] | null {
    if (!this.scopeExists(guildId)) return null;
    const row = this.getRow<{ readonly roleIds: string | null }>(
      `SELECT roleIds FROM ${this.tableName(guildId)} WHERE idType = ?`,
      idType
    );
    return deserializeIds(row?.roleIds ?? null);
  }
}
