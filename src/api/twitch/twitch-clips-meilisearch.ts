import { type Index, type Meilisearch, MeilisearchApiError } from 'meilisearch';

const MAX_TOTAL_HITS = 3000;

export class TwitchClipsMeilisearch {
  readonly #meilisearch: Readonly<Pick<Meilisearch, 'getIndex' | 'createIndex'>>;
  readonly #indexes = new Map<string, Promise<Index>>();

  public constructor(meilisearch: Readonly<Pick<Meilisearch, 'getIndex' | 'createIndex'>>) {
    this.#meilisearch = meilisearch;
  }

  public async getOrCreateIndex(guildId: string): Promise<Index> {
    const name = `twitchClips_${guildId}`;
    let pending = this.#indexes.get(name);
    if (pending === undefined) {
      pending = this.#loadIndex(name);
      this.#indexes.set(name, pending);
    }
    try {
      return await pending;
    } catch (error) {
      if (this.#indexes.get(name) === pending) this.#indexes.delete(name);
      throw error;
    }
  }

  /** Release local SDK state when Botge leaves a guild; persisted documents remain untouched. */
  public releaseIndex(guildId: string): void {
    this.#indexes.delete(`twitchClips_${guildId}`);
  }

  async #loadIndex(name: string): Promise<Index> {
    let index: Index;
    try {
      index = await this.#meilisearch.getIndex(name);
    } catch (error) {
      if (!(error instanceof MeilisearchApiError) || error.cause?.code !== 'index_not_found')
        throw error;
      try {
        await this.#meilisearch.createIndex(name, { primaryKey: 'id' }).waitTask();
      } catch (createError) {
        if (
          !(createError instanceof MeilisearchApiError)
          || createError.cause?.code !== 'index_already_exists'
        )
          throw createError;
      }
      index = await this.#meilisearch.getIndex(name);
    }
    await index
      .updateSettings({
        pagination: { maxTotalHits: MAX_TOTAL_HITS },
        searchableAttributes: ['title'],
        filterableAttributes: ['creator_name', 'game_id'],
        sortableAttributes: ['view_count', 'created_at']
      })
      .waitTask();
    return index;
  }
}
