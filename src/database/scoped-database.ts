import { BaseDatabase, quoteIdentifier } from './base-database.ts';

/** Support the existing per-user and per-guild tables without changing their on-disk layout. */
export abstract class ScopedDatabase extends BaseDatabase {
  readonly #tablePrefix: string;
  readonly #columns: string;

  protected constructor(filepath: string, tablePrefix: string, columns: string) {
    super(filepath);
    this.#tablePrefix = tablePrefix;
    this.#columns = columns;
  }

  protected tableName(scopeId: string): string {
    return quoteIdentifier(`${this.#tablePrefix}_${scopeId}`);
  }

  protected scopeExists(scopeId: string): boolean {
    return this.hasTable(`${this.#tablePrefix}_${scopeId}`);
  }

  protected ensureTable(scopeId: string): void {
    this.databaseSync.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName(scopeId)} (${this.#columns}) STRICT`
    );
  }
}
