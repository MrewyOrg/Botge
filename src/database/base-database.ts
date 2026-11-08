import { DatabaseSync, type SQLInputValue, type StatementResultingChanges } from 'node:sqlite';

/** Quote SQL identifiers; values must still be passed as bound parameters. */
export function quoteIdentifier(identifier: string): string {
  if (identifier.includes('\0')) throw new Error('SQL identifiers cannot contain null characters.');
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Shared connection ownership, schema initialization, and typed query helpers. */
export abstract class BaseDatabase {
  readonly #databaseSync: Readonly<DatabaseSync>;

  protected constructor(filepath: string, schema?: string) {
    this.#databaseSync = new DatabaseSync(filepath);
    try {
      if (schema !== undefined) this.#databaseSync.exec(schema);
    } catch (error) {
      this.#databaseSync.close();
      throw error;
    }
  }

  protected get databaseSync(): Readonly<DatabaseSync> {
    return this.#databaseSync;
  }

  public close(): void {
    if (this.#databaseSync.isOpen) this.#databaseSync.close();
  }

  // Row types describe the selected SQL columns; these assertions do not validate stored data.
  protected getRow<Row>(sql: string, ...parameters: readonly SQLInputValue[]): Row | undefined {
    return this.#databaseSync.prepare(sql).get(...parameters) as Row | undefined;
  }

  protected getRows<Row>(sql: string, ...parameters: readonly SQLInputValue[]): readonly Row[] {
    return this.#databaseSync.prepare(sql).all(...parameters) as Row[];
  }

  protected execute(
    sql: string,
    ...parameters: readonly SQLInputValue[]
  ): StatementResultingChanges {
    return this.#databaseSync.prepare(sql).run(...parameters);
  }

  protected hasTable(tableName: string): boolean {
    return (
      this.getRow(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?`, tableName)
      !== undefined
    );
  }
}
