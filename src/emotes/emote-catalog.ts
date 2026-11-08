import type { AssetInfo, Platform } from '../types.ts';

/** Sources are ordered from highest to lowest priority and replaced atomically on refresh. */
export type EmoteSources = () => readonly (readonly AssetInfo[])[];
type Entry = { readonly asset: AssetInfo; readonly normalized: string };

/** One entry per asset, with exact-name indexes and a linear substring search. */
export class EmoteCatalog {
  readonly #sources: EmoteSources;
  #previous: readonly (readonly AssetInfo[])[] = [];
  #entries: readonly Entry[] = [];
  readonly #exact = new Map<string, AssetInfo>();
  readonly #normalized = new Map<string, AssetInfo>();

  public constructor(sources: EmoteSources) {
    this.#sources = sources;
  }

  public matchSingle(query: string): AssetInfo | undefined {
    this.#update();
    const normalized = query.toLowerCase();
    return (
      this.#exact.get(query)
      ?? this.#normalized.get(normalized)
      ?? this.#entries.find((entry) => entry.normalized.includes(normalized))?.asset
    );
  }

  public matchSingleArray(
    query: string,
    platform?: Platform,
    animated?: boolean,
    zeroWidth?: boolean,
    max?: number,
    sortByDateAdded?: boolean,
    sortByName?: boolean,
    isSlashEmote?: boolean
  ): readonly AssetInfo[] | undefined {
    this.#update();
    const normalized = query.toLowerCase();
    const personalOnly =
      isSlashEmote === true && process.env['AUTOCOMPLETE_ONLY_7TV_PERSONAL'] === 'true';
    const matches = this.#entries.filter(
      ({ asset, normalized: name }) =>
        name.includes(normalized)
        && (platform === undefined || asset.platform === platform)
        && (animated === undefined || asset.animated === animated)
        && (zeroWidth === undefined || asset.zeroWidth === zeroWidth)
        && (!personalOnly || asset.isSevenTVPersonal)
    );
    if (matches.length === 0) return undefined;
    const rank = (entry: Readonly<Entry>): number => {
      if (query === '') return 0;
      if (entry.asset.name === query) return 0;
      if (entry.normalized === normalized) return 1;
      return entry.normalized.startsWith(normalized) ? 2 : 3;
    };
    matches.sort(
      (a, b) =>
        rank(a) - rank(b)
        || (sortByDateAdded === true ?
          (b.asset.timestamp ?? -Infinity) - (a.asset.timestamp ?? -Infinity)
        : sortByName === true ? a.asset.name.localeCompare(b.asset.name)
        : 0)
    );
    const assets = matches.map(({ asset }) => asset);
    return max === undefined ? assets : assets.slice(0, Math.max(0, Math.trunc(max)));
  }

  public matchSingleUnique(query: string, original: string): boolean {
    this.#update();
    const normalized = query.toLowerCase();
    let match: AssetInfo | undefined;
    for (const entry of this.#entries) {
      if (!entry.normalized.includes(normalized)) continue;
      if (match !== undefined) return false;
      match = entry.asset;
    }
    return match?.name === original;
  }

  public matchSingleExact(query: string): boolean {
    this.#update();
    return this.#exact.has(query);
  }

  public matchMulti(queries: readonly string[]): readonly (AssetInfo | undefined)[] {
    return queries.map((query) => (query.length > 1 ? this.matchSingle(query) : undefined));
  }

  #update(): void {
    const sources = this.#sources();
    if (
      sources.length === this.#previous.length
      && sources.every((source, index) => source === this.#previous[index])
    )
      return;
    this.#previous = sources;
    this.#exact.clear();
    this.#normalized.clear();
    const entries = new Map<string, Entry>();
    for (const source of sources) {
      for (const asset of source) {
        const key = `${asset.platform}\0${asset.id}\0${asset.name}`;
        const entry = entries.get(key);
        if (entry !== undefined) {
          if (asset.isSevenTVPersonal && !entry.asset.isSevenTVPersonal) {
            const merged = { ...entry.asset, isSevenTVPersonal: true };
            entries.set(key, { ...entry, asset: merged });
            if (this.#exact.get(asset.name) === entry.asset) this.#exact.set(asset.name, merged);
            if (this.#normalized.get(entry.normalized) === entry.asset)
              this.#normalized.set(entry.normalized, merged);
          }
          continue;
        }
        if (asset.platform === 'sevenNotInSet' && this.#exact.has(asset.name)) continue;
        const normalized = asset.name.toLowerCase();
        entries.set(key, { asset, normalized });
        if (!this.#exact.has(asset.name)) this.#exact.set(asset.name, asset);
        if (!this.#normalized.has(normalized)) this.#normalized.set(normalized, asset);
      }
    }
    this.#entries = [...entries.values()];
  }
}
