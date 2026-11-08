import { quoteIdentifier } from './base-database.ts';
import { ScopedDatabase } from './scoped-database.ts';

type NamedEntry = {
  readonly name: string;
  readonly value: string;
  readonly dateAdded: Readonly<Date>;
};
type StoredEntry = Omit<NamedEntry, 'dateAdded'> & { readonly dateAdded: number };

/** Common storage for named, dated content such as media and quotes. */
export abstract class NamedEntriesDatabase extends ScopedDatabase {
  readonly #valueColumn: string;

  protected constructor(filepath: string, tablePrefix: string, valueColumn: string) {
    const column = quoteIdentifier(valueColumn);
    super(
      filepath,
      tablePrefix,
      `name TEXT NOT NULL PRIMARY KEY, ${column} TEXT NOT NULL, dateAdded INTEGER NOT NULL`
    );
    this.#valueColumn = column;
  }

  protected insertEntry(scopeId: string, entry: NamedEntry): void {
    this.ensureTable(scopeId);
    this.execute(
      `INSERT INTO ${this.tableName(scopeId)} (name, ${this.#valueColumn}, dateAdded) VALUES (?, ?, ?)`,
      entry.name,
      entry.value,
      entry.dateAdded.getTime()
    );
  }

  protected deleteEntry(scopeId: string, name: string, value: string): void {
    if (!this.scopeExists(scopeId)) return;
    this.execute(
      `DELETE FROM ${this.tableName(scopeId)} WHERE name = ? AND ${this.#valueColumn} = ?`,
      name,
      value
    );
  }

  protected renameEntry(scopeId: string, value: string, name: string): void {
    if (!this.scopeExists(scopeId)) return;
    this.execute(
      `UPDATE ${this.tableName(scopeId)} SET name = ? WHERE ${this.#valueColumn} = ?`,
      name,
      value
    );
  }

  protected getEntryName(scopeId: string, value: string): string | undefined {
    if (!this.scopeExists(scopeId)) return undefined;
    return this.getRow<{ readonly name: string }>(
      `SELECT name FROM ${this.tableName(scopeId)} WHERE ${this.#valueColumn} = ? ORDER BY dateAdded DESC, name LIMIT 1`,
      value
    )?.name;
  }

  protected findEntryValue(scopeId: string, name: string): string | undefined {
    if (!this.scopeExists(scopeId)) return undefined;
    // Prefer exact names, then case-insensitive names, then newest literal substring matches.
    return this.getRow<{ readonly value: string }>(
      `
      SELECT ${this.#valueColumn} AS value FROM ${this.tableName(scopeId)}
      WHERE instr(lower(name), lower(?)) > 0
      ORDER BY CASE WHEN name = ? THEN 0 WHEN name = ? COLLATE NOCASE THEN 1 ELSE 2 END,
        dateAdded DESC, name
      LIMIT 1
    `,
      name,
      name,
      name
    )?.value;
  }

  protected getEntries(scopeId: string): readonly NamedEntry[] {
    if (!this.scopeExists(scopeId)) return [];
    return this.getRows<StoredEntry>(
      `SELECT name, ${this.#valueColumn} AS value, dateAdded FROM ${this.tableName(scopeId)} ORDER BY dateAdded DESC, name`
    ).map((entry) => ({ ...entry, dateAdded: new Date(entry.dateAdded) }));
  }

  protected entryValueExists(scopeId: string, value: string): boolean {
    return (
      this.scopeExists(scopeId)
      && this.getRow(
        `SELECT 1 FROM ${this.tableName(scopeId)} WHERE ${this.#valueColumn} = ? LIMIT 1`,
        value
      ) !== undefined
    );
  }

  protected entryNameExists(scopeId: string, name: string): boolean {
    return (
      this.scopeExists(scopeId)
      && this.getRow(`SELECT 1 FROM ${this.tableName(scopeId)} WHERE name = ?`, name) !== undefined
    );
  }
}
