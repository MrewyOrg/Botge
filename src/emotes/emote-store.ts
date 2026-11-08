import { requestJson } from '../api/http.ts';
import type { TwitchApi } from '../api/twitch/twitch-api.ts';
import type { AddedEmotesDatabase } from '../database/added-emotes-database.ts';
import type { AddedEmote, AssetInfo, SevenTVEmoteNotInSet, SevenTVEmotes } from '../types.ts';
import { logError } from '../utils/log-error.ts';
import { EmoteCatalog } from './emote-catalog.ts';
import {
  bttvToAsset,
  ffzToAsset,
  sevenTVInSetToAsset,
  sevenTVNotInSetToAsset,
  twitchToAsset
} from './emote-to-asset.ts';
import type { PersonalEmoteSets } from './personal-emote-sets.ts';
import {
  parseBTTVGlobal,
  parseBTTVSet,
  parseFFZGlobal,
  parseFFZSet,
  parseSevenTVEmote
} from './provider-data.ts';
import type { EmoteProviderSettings } from './provider-policy.ts';
import { sevenTVEvents, type SevenTVSet } from './seventv/event-client.ts';

function convert<T>(
  emotes: readonly T[],
  convertEmote: (emote: T) => AssetInfo
): readonly AssetInfo[] {
  return emotes.flatMap((emote) => {
    try {
      return [convertEmote(emote)];
    } catch (error) {
      logError(error, 'Skipping invalid emote');
      return [];
    }
  });
}

const globalSevenTV = new WeakMap<SevenTVEmotes, readonly AssetInfo[]>();
const personalSevenTV = new WeakMap<SevenTVEmotes, readonly AssetInfo[]>();
const EMPTY: readonly AssetInfo[] = [];
function sevenTVAssets(set: SevenTVSet | undefined, personal: boolean): readonly AssetInfo[] {
  if (set === undefined) return EMPTY;
  const { snapshot } = set;
  const cache = personal ? personalSevenTV : globalSevenTV;
  let assets = cache.get(snapshot);
  if (assets === undefined) {
    assets = convert(snapshot.emotes, (emote) => sevenTVInSetToAsset(emote, personal));
    cache.set(snapshot, assets);
  }
  return assets;
}

export class GlobalEmoteStore {
  static #instance: GlobalEmoteStore | undefined;
  readonly #providers: EmoteProviderSettings;
  readonly #twitchApi: Readonly<TwitchApi> | undefined;
  readonly #addedEmotesDatabase: Readonly<AddedEmotesDatabase>;
  #sevenTV: SevenTVSet | undefined;
  #otherSources: readonly (readonly AssetInfo[])[] = [];

  private constructor(
    twitchApi: Readonly<TwitchApi> | undefined,
    addedEmotesDatabase: Readonly<AddedEmotesDatabase>,
    providers: EmoteProviderSettings
  ) {
    this.#twitchApi = twitchApi;
    this.#addedEmotesDatabase = addedEmotesDatabase;
    this.#providers = { ...providers };
  }

  public static get instance(): Readonly<GlobalEmoteStore> {
    if (this.#instance === undefined) throw new Error('Global emote store not initialized.');
    return this.#instance;
  }
  public get providers(): EmoteProviderSettings {
    return this.#providers;
  }
  public get addedEmotesDatabase(): Readonly<AddedEmotesDatabase> {
    return this.#addedEmotesDatabase;
  }
  public get sources(): readonly (readonly AssetInfo[])[] {
    return [sevenTVAssets(this.#sevenTV, false), ...this.#otherSources];
  }

  public static async createInstance(
    twitchApi: Readonly<TwitchApi> | undefined,
    addedEmotesDatabase: Readonly<AddedEmotesDatabase>,
    providers: EmoteProviderSettings
  ): Promise<void> {
    const store = new GlobalEmoteStore(twitchApi, addedEmotesDatabase, providers);
    await store.refreshGlobalEmotes();
    if (providers.use7TVGlobalEmotes)
      store.#sevenTV = await sevenTVEvents.watch('https://7tv.io/v3/emote-sets/global');
    if (this.#instance !== undefined) this.#instance.#sevenTV?.dispose();
    this.#instance = store;
  }

  public async refreshGlobalEmotes(): Promise<void> {
    const [bttv, ffz, twitch] = await Promise.all([
      this.#providers.useBTTVEmotes ?
        requestJson('https://api.betterttv.net/3/cached/emotes/global').then(parseBTTVGlobal)
      : undefined,
      this.#providers.useFFZEmotes ?
        requestJson('https://api.frankerfacez.com/v1/set/global').then(parseFFZGlobal)
      : undefined,
      this.#providers.useTwitchEmotes ? this.#twitchApi?.emotesGlobal() : undefined
    ]);
    this.#otherSources = [
      convert(bttv ?? [], bttvToAsset),
      convert(ffz?.sets['3']?.emoticons ?? [], ffzToAsset),
      convert(twitch?.data ?? [], twitchToAsset)
    ];
  }
}

export class PersonalEmoteStore {
  readonly #guildId: string;
  readonly #providers: EmoteProviderSettings;
  readonly #catalog: Readonly<EmoteCatalog>;
  #personalEmoteSets: PersonalEmoteSets | undefined;
  #sevenTV: SevenTVSet | undefined;
  #personalSources: readonly (readonly AssetInfo[])[] = [];
  #addedEmotes: readonly SevenTVEmoteNotInSet[] = [];
  #addedAssets: readonly AssetInfo[] = [];
  #changes: Promise<void> = Promise.resolve();

  private constructor(guildId: string) {
    this.#guildId = guildId;
    this.#providers = GlobalEmoteStore.instance.providers;
    this.#catalog = new EmoteCatalog(() => [
      ...GlobalEmoteStore.instance.sources,
      sevenTVAssets(this.#sevenTV, true),
      ...this.#personalSources,
      this.#addedAssets
    ]);
  }

  public get catalog(): Readonly<EmoteCatalog> {
    return this.#catalog;
  }

  public get personalEmoteSets(): PersonalEmoteSets | undefined {
    return this.#personalEmoteSets;
  }

  public static async create(
    guildId: string,
    personalEmoteSets: PersonalEmoteSets | undefined
  ): Promise<Readonly<PersonalEmoteStore>> {
    const store = new PersonalEmoteStore(guildId);
    try {
      if (store.#providers.use7TVAddedEmotes) await store.#refreshAddedEmotes();
      if (personalEmoteSets !== undefined) await store.changePersonalEmoteSets(personalEmoteSets);
      return store;
    } catch (error) {
      store.dispose();
      throw error;
    }
  }

  public async changePersonalEmoteSets(sets: PersonalEmoteSets): Promise<void> {
    // Serialize configuration changes; commit only after every new source is available.
    const change = this.#changes.then(async () => {
      const sameSevenTV = sets.sevenTv === this.#personalEmoteSets?.sevenTv;
      const sources = await this.#fetchPersonalSources(sets);
      const sevenTV =
        !this.#providers.use7TVPersonalEmotes ? undefined
        : sameSevenTV ? this.#sevenTV
        : sets.sevenTv === null ? undefined
        : await sevenTVEvents.watch(sets.sevenTv);
      if (!sameSevenTV) this.#sevenTV?.dispose();
      this.#sevenTV = sevenTV;
      this.#personalSources = sources;
      this.#personalEmoteSets = sets;
    });
    this.#changes = change.catch(() => undefined);
    await change;
  }

  public async refreshBTTVAndFFZPersonalEmotes(): Promise<void> {
    const refresh = this.#changes.then(async () => {
      this.#personalSources = await this.#fetchPersonalSources(this.#personalEmoteSets);
    });
    this.#changes = refresh.catch(() => undefined);
    await refresh;
  }

  public addSevenTVEmoteNotInSet(emote: SevenTVEmoteNotInSet): void {
    if (!this.#providers.use7TVAddedEmotes)
      throw new Error('Added 7TV emotes are disabled by the operator.');
    this.#addedEmotes = [
      ...this.#addedEmotes.filter((existing) => existing.id !== emote.id),
      emote
    ];
    this.#addedAssets = convert(this.#addedEmotes, sevenTVNotInSetToAsset);
  }

  public removeSevenTVEmoteNotInSet(added: AddedEmote): void {
    const id = added.url.split('/').at(-1);
    this.#addedEmotes = this.#addedEmotes.filter((emote) => emote.id !== id);
    this.#addedAssets = convert(this.#addedEmotes, sevenTVNotInSetToAsset);
  }

  public dispose(): void {
    this.#sevenTV?.dispose();
  }

  async #fetchPersonalSources(
    sets: PersonalEmoteSets | undefined
  ): Promise<readonly (readonly AssetInfo[])[]> {
    const [bttv, ffz] = await Promise.all([
      this.#providers.useBTTVEmotes && sets?.bttv !== null && sets?.bttv !== undefined ?
        requestJson(sets.bttv).then(parseBTTVSet)
      : undefined,
      this.#providers.useFFZEmotes && sets?.ffz !== null && sets?.ffz !== undefined ?
        requestJson(sets.ffz).then(parseFFZSet)
      : undefined
    ]);
    return [
      convert(bttv?.channelEmotes ?? [], bttvToAsset),
      convert(bttv?.sharedEmotes ?? [], bttvToAsset),
      convert(ffz?.sets[ffz.room.set]?.emoticons ?? [], ffzToAsset)
    ];
  }

  async #refreshAddedEmotes(): Promise<void> {
    const added = GlobalEmoteStore.instance.addedEmotesDatabase.getAll(this.#guildId);
    const results = await Promise.allSettled(
      added.map(async ({ url, alias }) => {
        const emote = parseSevenTVEmote(await requestJson(url));
        if (emote.error !== undefined) throw new Error(emote.error);
        return alias === null ? emote : { ...emote, name: alias };
      })
    );
    this.#addedEmotes = results.flatMap(
      (
        result:
          | { readonly status: 'fulfilled'; readonly value: SevenTVEmoteNotInSet }
          | { readonly status: 'rejected'; readonly reason: unknown }
      ) => {
        if (result.status === 'fulfilled') return [result.value];
        logError(result.reason, 'Failed to load added emote');
        return [];
      }
    );
    this.#addedAssets = convert(this.#addedEmotes, sevenTVNotInSetToAsset);
  }
}
