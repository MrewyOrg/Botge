# Database classes

Each class owns one SQLite connection. Existing database filenames, table names, and column layouts
are preserved, including per-user and per-guild tables. Tests use `:memory:` or temporary files.

## Shared building blocks

- `BaseDatabase`: initializes an optional schema, closes safely more than once, and provides
  `getRow<Row>()`, `getRows<Row>()`, and `execute()` with bound SQL parameters. Row types describe
  the selected columns; they do not perform runtime validation.
- `ScopedDatabase`: creates and finds tables named `<prefix>_<scopeId>`. Table identifiers are
  quoted; values still use bound parameters. Schema SQL must be a trusted constant from the code.
- `NamedEntriesDatabase`: shared storage for named, dated values, used by media and quotes. It
  handles insertion, deletion, renaming, existence checks, sorting, and literal substring lookup.
- `id-list.ts`: preserves the existing comma-separated storage format for Discord ID lists.
- `open-databases.ts`: the typed registry of database files and classes. It closes connections
  already opened if a later database fails to initialize.

## Add a database

For a single table, extend `BaseDatabase` and pass an idempotent schema to `super`:

```typescript
import { BaseDatabase } from './base-database.ts';

const SCHEMA = `CREATE TABLE IF NOT EXISTS examples (
  id TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) STRICT`;

export class ExamplesDatabase extends BaseDatabase {
  public constructor(filepath: string) {
    super(filepath, SCHEMA);
  }

  public save(id: string, value: string): void {
    this.execute(
      `INSERT INTO examples (id, value) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET value = excluded.value`,
      id,
      value
    );
  }

  public find(id: string): string | undefined {
    return this.getRow<{ readonly value: string }>('SELECT value FROM examples WHERE id = ?', id)
      ?.value;
  }
}
```

Add its import and one entry to `DATABASE_DEFINITIONS` in `open-databases.ts`:

```typescript
examplesDatabase: {
  filename: 'examples.sqlite',
  create: (filepath: string): ExamplesDatabase => new ExamplesDatabase(filepath)
}
```

Keep the factory return type explicit for isolated declarations. Startup opens registered files;
`DatabaseManager` closes them. Access this database through
`databaseManager.databases.examplesDatabase`; no startup or manager changes are needed. Existing
database getters remain available.

For another per-user collection similar to media or quotes, extend `NamedEntriesDatabase` instead
and provide a table prefix and value column. Keep the public methods specific to that domain. Use
`ScopedDatabase` for other cases that need the existing per-scope table pattern.

Add an in-memory round-trip test and, when changing an existing schema, a test that opens an old
on-disk fixture. `CREATE TABLE IF NOT EXISTS` does not migrate existing tables: column changes need
an explicit, data-preserving migration. Bind user values with `?`; use `quoteIdentifier` for SQL
identifiers that cannot be bound.
