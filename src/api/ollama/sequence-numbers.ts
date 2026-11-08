import { readFileSync } from 'node:fs';

import { writeFileAtomically } from '../../utils/write-file-atomically.ts';

/** Lazy, validated high-water marks; keep the existing channel-to-number JSON format. */
export class SequenceNumbers {
  readonly #path: string;
  #values: ReadonlyMap<string, number> | undefined;

  public constructor(path: string) {
    this.#path = path;
  }

  public has(channelId: string): boolean {
    this.#values ??= this.#load();
    return this.#values.has(channelId);
  }

  public reserve(channelId: string, requested?: number): number {
    this.#values ??= this.#load();
    const current = this.#values.get(channelId) ?? 0;
    const next = requested ?? current + 1;
    if (!Number.isSafeInteger(next) || next < 0)
      throw new Error('Invalid message sequence number.');
    if (!this.#values.has(channelId) || next > current) {
      const updated = new Map(this.#values).set(channelId, Math.max(current, next));
      writeFileAtomically(this.#path, JSON.stringify(Object.fromEntries(updated), null, 2));
      this.#values = updated;
    }
    return next;
  }

  #load(): ReadonlyMap<string, number> {
    let text: string;
    try {
      text = readFileSync(this.#path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Map();
      throw error;
    }
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Invalid message sequence file.');
    const result = new Map<string, number>();
    for (const [channel, sequence] of Object.entries(value)) {
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0)
        throw new Error('Invalid message sequence file.');
      result.set(channel, sequence);
    }
    return result;
  }
}
