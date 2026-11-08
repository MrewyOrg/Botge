import type { DatabaseInstances } from '../database/open-databases.ts';

export class DatabaseManager {
  readonly #databases: DatabaseInstances;

  public constructor(databases: DatabaseInstances) {
    this.#databases = Object.freeze({ ...databases });
  }

  /** Typed access to every registered database, including newly added entries. */
  public get databases(): DatabaseInstances {
    return this.#databases;
  }

  public get broadcasterNameAndPersonalEmoteSetsDatabase(): DatabaseInstances['broadcasterNameAndPersonalEmoteSetsDatabase'] {
    return this.#databases.broadcasterNameAndPersonalEmoteSetsDatabase;
  }
  public get permittedRoleIdsDatabase(): DatabaseInstances['permittedRoleIdsDatabase'] {
    return this.#databases.permittedRoleIdsDatabase;
  }
  public get addedEmotesDatabase(): DatabaseInstances['addedEmotesDatabase'] {
    return this.#databases.addedEmotesDatabase;
  }
  public get mediaDatabase(): DatabaseInstances['mediaDatabase'] {
    return this.#databases.mediaDatabase;
  }
  public get quoteDatabase(): DatabaseInstances['quoteDatabase'] {
    return this.#databases.quoteDatabase;
  }
  public get pingsDatabase(): DatabaseInstances['pingsDatabase'] {
    return this.#databases.pingsDatabase;
  }
  public get usersDatabase(): DatabaseInstances['usersDatabase'] {
    return this.#databases.usersDatabase;
  }

  public closeDatabases(): void {
    const errors: unknown[] = [];

    for (const database of Object.values(this.#databases)) {
      try {
        database.close();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) throw new AggregateError(errors, 'Failed to close databases.');
  }
}
