import { readFileSync } from 'node:fs';

import { writeFileAtomically } from '../utils/write-file-atomically.ts';

/** Validate the common OAuth token response without trusting a JSON type assertion. */
export function parseAccessToken(value: unknown): string {
  if (
    typeof value !== 'object'
    || value === null
    || !('access_token' in value)
    || typeof value.access_token !== 'string'
    || value.access_token.trim() === ''
  )
    throw new Error('OAuth response did not contain an access token.');
  return value.access_token;
}

export async function loadAccessToken(
  path: string,
  acquire: () => Promise<string>
): Promise<{ readonly token: string; readonly cached: boolean }> {
  try {
    const token = readFileSync(path, 'utf8').trim();
    if (token !== '') return { token, cached: true };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  const token = await acquire();
  writeFileAtomically(path, token);
  return { token, cached: false };
}

/** Share concurrent refreshes and ignore 401s for a token that was already replaced. */
export class AccessToken {
  #value: string;
  #refresh: Promise<void> | undefined;
  readonly #path: string;
  readonly #acquire: () => Promise<string>;

  public constructor(value: string, path: string, acquire: () => Promise<string>) {
    this.#value = value;
    this.#path = path;
    this.#acquire = acquire;
  }

  public get value(): string {
    return this.#value;
  }

  public async refresh(invalidToken: string): Promise<void> {
    if (invalidToken !== this.#value) return;
    const pending = this.#refresh ?? this.#replace();
    this.#refresh = pending;
    try {
      await pending;
    } finally {
      if (this.#refresh === pending) this.#refresh = undefined;
    }
  }

  async #replace(): Promise<void> {
    const token = await this.#acquire();
    writeFileAtomically(this.#path, token);
    this.#value = token;
  }
}
