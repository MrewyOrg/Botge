import type { AddedEmote } from '../types.ts';
import { ScopedDatabase } from './scoped-database.ts';

export class AddedEmotesDatabase extends ScopedDatabase {
  public constructor(filepath: string) {
    super(filepath, 'addedEmotes', 'url TEXT NOT NULL PRIMARY KEY, alias TEXT');
  }

  public insert(addedEmote: AddedEmote, guildId: string): void {
    this.ensureTable(guildId);
    this.execute(
      `INSERT INTO ${this.tableName(guildId)} (url, alias) VALUES (?, ?)`,
      addedEmote.url,
      addedEmote.alias
    );
  }
  public delete(addedEmote: AddedEmote, guildId: string): void {
    if (!this.scopeExists(guildId)) return;
    this.execute(
      `DELETE FROM ${this.tableName(guildId)} WHERE url = ? AND (alias IS ? OR alias IS NULL)`,
      addedEmote.url,
      addedEmote.alias
    );
  }
  public getAll(guildId: string): readonly AddedEmote[] {
    if (!this.scopeExists(guildId)) return [];
    return this.getRows<AddedEmote>(`SELECT url, alias FROM ${this.tableName(guildId)}`);
  }
  public createTable(guildId: string): void {
    this.ensureTable(guildId);
  }
}
