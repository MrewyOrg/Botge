/** @format */

import {
  sevenTVInSetToAsset,
  sevenTVNotInSetToAsset,
  bttvToAsset,
  ffzToAsset,
  twitchToAsset
} from '../../utils/modules/emote-matcher/emote-to-asset.ts';
import type {
  Platform,
  SevenTVEmoteNotInSet,
  BTTVEmote,
  SevenTVEmotes,
  BTTVPersonalEmotes,
  FFZPersonalEmotes,
  FFZGlobalEmotes,
  TwitchGlobalEmotes,
  AssetInfo
} from '../../types.ts';

const FFZ_GLOBAL_SETS_KEY = 3 as const;

class EmoteNode {
  #highestPriority: number;
  readonly #assets: AssetInfo[];
  #uniquePath: boolean;

  public constructor(priority: number, asset: AssetInfo) {
    this.#highestPriority = priority;
    this.#assets = [asset];
    this.#uniquePath = true;
  }

  public get highestPriority(): number {
    return this.#highestPriority;
  }
  public get assets(): AssetInfo[] {
    return this.#assets;
  }
  public get uniquePath(): boolean {
    return this.#uniquePath;
  }

  public set highestPriority(highestPriority: number) {
    this.#highestPriority = highestPriority;
  }
  public set uniquePath(uniquePath: boolean) {
    this.#uniquePath = uniquePath;
  }
}

class SuffixTree {
  readonly #paths: Map<string, SuffixTree>;
  #data: EmoteNode | undefined;

  public constructor() {
    this.#paths = new Map<string, SuffixTree>();
    this.#data = undefined;
  }

  public addAllSuffix(asset: AssetInfo, priority: number): void {
    const normalized = asset.name.toLowerCase();

    for (let i = 0; i < normalized.length; i++) {
      this.#addAllSuffix(normalized.slice(i), priority, asset);
    }
  }

  public query(suffix: string): AssetInfo | undefined {
    return this.#query(suffix.toLowerCase(), suffix);
  }

  public queryArray(
    suffix: string,
    original: string,
    platform?: Platform,
    animated?: boolean,
    zeroWidth?: boolean,
    max?: number,
    sortByDateAdded?: boolean,
    sortByName?: boolean,
    isSlashEmote?: boolean
  ): readonly AssetInfo[] | undefined {
    return this.#queryArray(
      suffix.toLowerCase(),
      original,
      platform,
      animated,
      zeroWidth,
      max,
      sortByDateAdded,
      sortByName,
      isSlashEmote
    );
  }

  public queryUnique(suffix: string, original: string): boolean {
    return this.#queryUnique(suffix.toLowerCase(), original);
  }

  public queryExact(suffix: string): boolean {
    return this.#queryExact(suffix.toLowerCase(), suffix);
  }

  #addAllSuffix(suffix: string, priority: number, asset: AssetInfo): void {
    if (this.#data === undefined) {
      this.#data = new EmoteNode(priority, asset);
    } else {
      this.#data.uniquePath = false;
      if (priority > this.#data.highestPriority) {
        this.#data.highestPriority = priority;
        this.#data.assets.unshift(asset);
      } else {
        this.#data.assets.push(asset);
      }
    }

    if (suffix !== '') {
      const tree = this.#getOrAddTree(suffix.charAt(0));
      if (tree !== undefined) tree.#addAllSuffix(suffix.slice(1), priority, asset);
    }
  }

  #query(normalizedSuffix: string, original: string): AssetInfo | undefined {
    if (normalizedSuffix === '') {
      if (this.#data === undefined) return undefined;
      // reached the end of the query string

      for (const asset of this.#data.assets) {
        if (asset.name === original) return asset;
      }

      for (const asset of this.#data.assets) {
        if (asset.name.toLowerCase() === original.toLowerCase()) return asset;
      }

      return this.#data.assets[0];
    }

    const nextChar = normalizedSuffix.charAt(0);
    if (!this.#paths.has(nextChar)) return undefined;

    const nextCharGet = this.#paths.get(nextChar);
    if (nextCharGet !== undefined) return nextCharGet.#query(normalizedSuffix.slice(1), original);
    return undefined;
  }

  #queryArray(
    normalizedSuffix: string,
    original: string,
    platform?: Platform,
    animated?: boolean,
    zeroWidth?: boolean,
    max?: number,
    sortByDateAdded?: boolean,
    sortByName?: boolean,
    isSlashEmote?: boolean
  ): readonly AssetInfo[] | undefined {
    if (normalizedSuffix !== '') {
      const nextChar = normalizedSuffix.charAt(0);
      if (!this.#paths.has(nextChar)) return undefined;

      const nextCharGet = this.#paths.get(nextChar);
      if (nextCharGet !== undefined)
        return nextCharGet.#queryArray(
          normalizedSuffix.slice(1),
          original,
          platform,
          animated,
          zeroWidth,
          max,
          sortByDateAdded,
          sortByName
        );
      return undefined;
    }

    let assets: AssetInfo[] = [];
    for (const asset of this.#data?.assets ?? []) {
      if (asset.name.includes(normalizedSuffix) && !assets.includes(asset)) {
        if (process.env['AUTOCOMPLETE_ONLY_7TV_PERSONAL'] === 'true') {
          if (isSlashEmote !== undefined && isSlashEmote) {
            if (asset.isSevenTVPersonal) assets.push(asset);
          } else assets.push(asset);
        } else assets.push(asset);
      }
    }

    if (platform !== undefined) assets = assets.filter((asset) => asset.platform === platform);
    if (animated !== undefined) assets = assets.filter((asset) => asset.animated === animated);
    if (zeroWidth !== undefined) assets = assets.filter((asset) => asset.zeroWidth === zeroWidth);

    if (assets.length === 0) return undefined;

    if (sortByDateAdded !== undefined && sortByDateAdded) {
      const assetsTimestampNotUndefined = assets.filter((asset) => asset.timestamp !== undefined);
      const assetsTimestampUndefined = assets.filter((asset) => asset.timestamp === undefined);

      assetsTimestampNotUndefined.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      assets = [...assetsTimestampNotUndefined, ...assetsTimestampUndefined];
    } else if (sortByName !== undefined && sortByName) {
      assets.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (original !== '') {
      const exactCaseMatch = ((): AssetInfo | undefined => {
        const exactCaseMatchIndex = assets.findIndex((asset) => asset.name === original);
        return exactCaseMatchIndex !== -1 ? assets.splice(exactCaseMatchIndex, 1)[0] : undefined;
      })();

      const lowerCaseMatch = ((): AssetInfo | undefined => {
        const lowerCaseMatchIndex = assets.findIndex(
          (asset) => asset.name.toLowerCase() === original.toLowerCase()
        );
        return lowerCaseMatchIndex !== -1 ? assets.splice(lowerCaseMatchIndex, 1)[0] : undefined;
      })();

      const startsWithLowerCaseMatches: AssetInfo[] = [];
      this.#getStartsWithLowerCaseMatches(
        assets,
        original.toLowerCase(),
        startsWithLowerCaseMatches
      );

      assets.unshift(...startsWithLowerCaseMatches);
      if (lowerCaseMatch !== undefined) assets.unshift(lowerCaseMatch);
      if (exactCaseMatch !== undefined) assets.unshift(exactCaseMatch);
    }

    if (max !== undefined) return assets.slice(0, max);
    return assets;
  }

  #queryUnique(normalizedSuffix: string, original: string): boolean {
    if (normalizedSuffix === '') {
      if (this.#data === undefined) return false;
      if (this.#data.uniquePath && this.#data.assets[0].name === original) return true;
      return false;
    }

    const nextChar = normalizedSuffix.charAt(0);
    if (!this.#paths.has(nextChar)) return false;
    const nextCharGet = this.#paths.get(nextChar);
    if (nextCharGet !== undefined)
      return nextCharGet.#queryUnique(normalizedSuffix.slice(1), original);
    return false;
  }

  #queryExact(normalizedSuffix: string, original: string): boolean {
    if (normalizedSuffix === '') {
      if (this.#data === undefined) return false;
      // reached the end of the query string
      for (const asset of this.#data.assets) {
        // exact match and case match
        if (asset.name === original) return true;
      }

      return false;
    }

    const nextChar = normalizedSuffix.charAt(0);
    if (!this.#paths.has(nextChar)) return false;
    const nextCharGet = this.#paths.get(nextChar);
    if (nextCharGet !== undefined)
      return nextCharGet.#queryExact(normalizedSuffix.slice(1), original);
    return false;
  }

  #getStartsWithLowerCaseMatches(
    assets: AssetInfo[],
    startsWithLowerCase: string,
    startsWithLowerCaseMatches: AssetInfo[]
  ): void {
    for (const [index, asset] of assets.entries()) {
      if (!asset.name.toLowerCase().startsWith(startsWithLowerCase)) continue;

      const [splicedAsset] = assets.splice(index, 1);
      startsWithLowerCaseMatches.push(splicedAsset);

      this.#getStartsWithLowerCaseMatches(assets, startsWithLowerCase, startsWithLowerCaseMatches);
      return;
    }
  }

  #getOrAddTree(char: string): SuffixTree | undefined {
    if (!this.#paths.has(char)) this.#paths.set(char, new SuffixTree());
    return this.#paths.get(char);
  }
}

export class EmoteMatcher {
  readonly #root: Readonly<SuffixTree>;
  readonly #priority: number;

  public constructor(
    sevenGlobal: SevenTVEmotes,
    bttvGlobal: readonly BTTVEmote[],
    ffzGlobal: FFZGlobalEmotes,
    twitchGlobal: TwitchGlobalEmotes | undefined,
    sevenPersonal: SevenTVEmotes | undefined,
    bttvPersonal: BTTVPersonalEmotes | undefined,
    ffzPersonal: FFZPersonalEmotes | undefined,
    sevenNotInSet: readonly Readonly<SevenTVEmoteNotInSet>[] | undefined
  ) {
    this.#root = new SuffixTree();
    let priority = arguments.length;

    for (const emote of sevenGlobal.emotes)
      this.#root.addAllSuffix(sevenTVInSetToAsset(emote, false), priority);
    priority--;

    try {
      for (const emote of bttvGlobal) this.#root.addAllSuffix(bttvToAsset(emote), priority);
    } catch {}
    priority--;

    try {
      for (const emote of ffzGlobal.sets[`${FFZ_GLOBAL_SETS_KEY}`].emoticons)
        this.#root.addAllSuffix(ffzToAsset(emote), priority);
    } catch {}
    priority--;

    try {
      for (const emote of twitchGlobal?.data ?? [])
        this.#root.addAllSuffix(twitchToAsset(emote), priority);
    } catch {}
    if (twitchGlobal !== undefined) priority--;

    for (const emote of sevenPersonal?.emotes ?? [])
      this.#root.addAllSuffix(sevenTVInSetToAsset(emote, true), priority);
    if (sevenPersonal !== undefined) priority--;

    try {
      for (const emote of bttvPersonal?.channelEmotes ?? [])
        this.#root.addAllSuffix(bttvToAsset(emote), priority);
    } catch {}
    if (bttvPersonal !== undefined) priority--;

    try {
      for (const emote of bttvPersonal?.sharedEmotes ?? [])
        this.#root.addAllSuffix(bttvToAsset(emote), priority);
    } catch {}
    if (bttvPersonal !== undefined) priority--;

    try {
      for (const emote of ffzPersonal?.sets[ffzPersonal.room.set].emoticons ?? [])
        this.#root.addAllSuffix(ffzToAsset(emote), priority);
    } catch {}
    if (ffzPersonal !== undefined) priority--;

    for (const emote of sevenNotInSet ?? []) {
      // there may be a case where an emote was added with /addemote
      // and afterwards added to the channel
      // or it was added to 7tv global emotes
      if (emote.error !== undefined) continue;
      if (this.matchSingleExact(emote.name)) continue;

      this.#root.addAllSuffix(sevenTVNotInSetToAsset(emote), priority);
    }

    this.#priority = priority;
  }

  public matchSingle(query: string): AssetInfo | undefined {
    return this.#root.query(query);
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
    return this.#root.queryArray(
      query,
      query,
      platform,
      animated,
      zeroWidth,
      max,
      sortByDateAdded,
      sortByName,
      isSlashEmote
    );
  }

  public matchSingleUnique(query: string, original: string): boolean {
    return this.#root.queryUnique(query, original);
  }

  public matchSingleExact(query: string): boolean {
    return this.#root.queryExact(query);
  }

  // returns undefined for unmatched
  public matchMulti(queries: readonly string[]): readonly (AssetInfo | undefined)[] {
    return queries.map((query) => (query.length !== 1 ? this.#root.query(query) : undefined));
  }

  public addSevenTVEmoteNotInSetSuffix(emote: Readonly<SevenTVEmoteNotInSet>): void {
    this.#root.addAllSuffix(sevenTVNotInSetToAsset(emote), this.#priority);
  }
}
