/** @format */

import { once } from 'helpful-decorators';

import type {
  SevenTVEmoteNotInSet,
  BTTVEmote,
  BTTVPersonalEmotes,
  FFZPersonalEmotes,
  FFZGlobalEmotes,
  SevenTVEmotes,
  TwitchGlobalEmotes,
  AddedEmote
} from '../../types.ts';
import type { PersonalEmoteSets } from './personal-emote-sets.ts';
import type { TwitchApi } from '../../api/twitch-api.ts';
import type { AddedEmotesDatabase } from '../../database/added-emotes-database.ts';
import { fetchAndJson } from '../../utils/public/fetch-and-json.ts';
import { EmoteMatcher } from './emote-matcher.ts';

const GLOBAL_EMOTE_ENDPOINTS = {
  sevenTV: 'https://7tv.io/v3/emote-sets/global',
  bttv: 'https://api.betterttv.net/3/cached/emotes/global',
  ffz: 'https://api.frankerfacez.com/v1/set/global'
} as const;

export class GlobalEmoteMatcherConstructor {
  static #instance: Readonly<GlobalEmoteMatcherConstructor> | undefined = undefined;
  readonly #load7TVGlobalEmotes: boolean;
  readonly #loadBTTVEmotes: boolean;
  readonly #loadFFZEmotes: boolean;
  readonly #loadTwitchEmotes: boolean;
  readonly #twitchApi: Readonly<TwitchApi> | undefined = undefined;
  readonly #addedEmotesDatabase: Readonly<AddedEmotesDatabase>;
  #sevenTVGlobal: SevenTVEmotes | undefined = undefined;
  #bttvGlobal: readonly BTTVEmote[] | undefined = undefined;
  #ffzGlobal: FFZGlobalEmotes | undefined = undefined;
  #twitchGlobal: TwitchGlobalEmotes | undefined = undefined;

  private constructor(
    twitchApi: Readonly<TwitchApi> | undefined,
    addedEmotesDatabase: Readonly<AddedEmotesDatabase>,
    load7TVGlobalEmotes: boolean,
    loadBTTVEmotes: boolean,
    loadFFZEmotes: boolean,
    loadTwitchEmotes: boolean
  ) {
    this.#twitchApi = twitchApi;
    this.#addedEmotesDatabase = addedEmotesDatabase;

    this.#load7TVGlobalEmotes = load7TVGlobalEmotes;
    this.#loadBTTVEmotes = loadBTTVEmotes;
    this.#loadFFZEmotes = loadFFZEmotes;
    this.#loadTwitchEmotes = loadTwitchEmotes;
  }

  public static get instance(): Readonly<GlobalEmoteMatcherConstructor> {
    if (GlobalEmoteMatcherConstructor.#instance === undefined)
      throw new Error('GlobalEmoteMatcherConstructor instance not created.');

    return GlobalEmoteMatcherConstructor.#instance;
  }

  public get addedEmotesDatabase(): Readonly<AddedEmotesDatabase> {
    return this.#addedEmotesDatabase;
  }
  public get twitchApi(): Readonly<TwitchApi> | undefined {
    return this.#twitchApi;
  }
  public get sevenTVGlobal(): SevenTVEmotes | undefined {
    return this.#sevenTVGlobal;
  }
  public get bttvGlobal(): readonly BTTVEmote[] | undefined {
    return this.#bttvGlobal;
  }
  public get ffzGlobal(): FFZGlobalEmotes | undefined {
    return this.#ffzGlobal;
  }
  public get twitchGlobal(): TwitchGlobalEmotes | undefined {
    return this.#twitchGlobal;
  }

  @once
  public static async createInstance(
    twitchApi: Readonly<TwitchApi> | undefined,
    addedEmotesDatabase: Readonly<AddedEmotesDatabase>,
    load7TVGlobalEmotes: boolean,
    loadBTTVEmotes: boolean,
    loadFFZEmotes: boolean,
    loadTwitchEmotes: boolean
  ): Promise<void> {
    GlobalEmoteMatcherConstructor.#instance = new GlobalEmoteMatcherConstructor(
      twitchApi,
      addedEmotesDatabase,
      load7TVGlobalEmotes,
      loadBTTVEmotes,
      loadFFZEmotes,
      loadTwitchEmotes
    );
    await GlobalEmoteMatcherConstructor.#instance.refreshGlobalEmotes();
  }

  public async refreshGlobalEmotes(): Promise<void> {
    const sevenTVGlobal =
      this.#load7TVGlobalEmotes ?
        (fetchAndJson(GLOBAL_EMOTE_ENDPOINTS.sevenTV) as Promise<SevenTVEmotes>)
      : undefined;
    const bttvGlobal =
      this.#loadBTTVEmotes ?
        (fetchAndJson(GLOBAL_EMOTE_ENDPOINTS.bttv) as Promise<readonly BTTVEmote[]>)
      : undefined;
    const ffzGlobal =
      this.#loadFFZEmotes ?
        (fetchAndJson(GLOBAL_EMOTE_ENDPOINTS.ffz) as Promise<FFZGlobalEmotes>)
      : undefined;
    const twitchGlobal = this.#loadTwitchEmotes ? this.#twitchApi?.emotesGlobal() : undefined;

    this.#sevenTVGlobal = await sevenTVGlobal;
    this.#bttvGlobal = await bttvGlobal;
    this.#ffzGlobal = await ffzGlobal;
    this.#twitchGlobal = await twitchGlobal;
  }
}

export class PersonalEmoteMatcherConstructor {
  readonly #guildId: string;
  readonly #loadBTTVEmotes: boolean;
  readonly #loadFFZEmotes: boolean;
  #personalEmoteSets: PersonalEmoteSets | undefined;
  #sevenTVPersonal: SevenTVEmotes | undefined = undefined;
  #bttvPersonal: BTTVPersonalEmotes | undefined = undefined;
  #ffzPersonal: FFZPersonalEmotes | undefined = undefined;
  #addedEmotes: SevenTVEmoteNotInSet[] | undefined = undefined;

  private constructor(
    guildId: string,
    personalEmoteSets: PersonalEmoteSets | undefined,
    loadBTTVEmotes: boolean,
    loadFFZEmotes: boolean
  ) {
    this.#guildId = guildId;
    this.#personalEmoteSets = personalEmoteSets;

    this.#loadBTTVEmotes = loadBTTVEmotes;
    this.#loadFFZEmotes = loadFFZEmotes;
  }

  public get personalEmoteSets(): PersonalEmoteSets | undefined {
    return this.#personalEmoteSets;
  }

  public static async create(
    guildId: string,
    personalEmoteSets: PersonalEmoteSets | undefined,
    loadBTTVEmotes: boolean,
    loadFFZEmotes: boolean
  ): Promise<Readonly<PersonalEmoteMatcherConstructor>> {
    const personalEmoteMatcherConstructor = new PersonalEmoteMatcherConstructor(
      guildId,
      personalEmoteSets,
      loadBTTVEmotes,
      loadFFZEmotes
    );

    const refreshBTTVAndFFZPersonalEmotes_ =
      personalEmoteMatcherConstructor.refreshBTTVAndFFZPersonalEmotes();
    const refreshAddedEmotes_ = personalEmoteMatcherConstructor.#refreshAddedEmotes();

    await refreshBTTVAndFFZPersonalEmotes_;
    await refreshAddedEmotes_;
    return personalEmoteMatcherConstructor;
  }

  public async changePersonalEmoteSets(
    personalEmoteSets: PersonalEmoteSets
  ): Promise<Readonly<EmoteMatcher> | undefined> {
    if (this.#personalEmoteSets === undefined) {
      this.#personalEmoteSets = personalEmoteSets;
      const { sevenTv, bttv, ffz } = this.#personalEmoteSets;
      if (bttv !== null || ffz !== null || sevenTv !== null) {
        if (bttv !== null || ffz !== null) await this.refreshBTTVAndFFZPersonalEmotes();
        return await this.constructEmoteMatcher();
      }

      return undefined;
    }

    const { sevenTv, bttv, ffz } = this.#personalEmoteSets;
    const newSevenTvPersonal = personalEmoteSets.sevenTv;
    const newBttvPersonal = personalEmoteSets.bttv;
    const newFfzPersonal = personalEmoteSets.ffz;

    if (bttv !== newBttvPersonal || ffz !== newFfzPersonal || sevenTv !== newSevenTvPersonal) {
      this.#personalEmoteSets = personalEmoteSets;

      if (bttv !== newBttvPersonal || ffz !== newFfzPersonal)
        await this.refreshBTTVAndFFZPersonalEmotes();
      return await this.constructEmoteMatcher();
    }

    return undefined;
  }

  public async constructEmoteMatcher(): Promise<Readonly<EmoteMatcher>> {
    const globalEmoteMatcherConstructor = GlobalEmoteMatcherConstructor.instance;

    const sevenTVPersonal =
      this.#personalEmoteSets !== undefined && this.#personalEmoteSets.sevenTv !== null ?
        (fetchAndJson(this.#personalEmoteSets.sevenTv) as Promise<SevenTVEmotes>)
      : undefined;
    this.#sevenTVPersonal = await sevenTVPersonal;

    return new EmoteMatcher(
      globalEmoteMatcherConstructor.sevenTVGlobal,
      globalEmoteMatcherConstructor.bttvGlobal,
      globalEmoteMatcherConstructor.ffzGlobal,
      globalEmoteMatcherConstructor.twitchGlobal,
      this.#sevenTVPersonal,
      this.#bttvPersonal,
      this.#ffzPersonal,
      this.#addedEmotes
    );
  }

  public async refreshBTTVAndFFZPersonalEmotes(): Promise<void> {
    if (this.#personalEmoteSets === undefined) return;

    const bttvPersonal =
      this.#loadBTTVEmotes && this.#personalEmoteSets.bttv !== null ?
        (fetchAndJson(this.#personalEmoteSets.bttv) as Promise<BTTVPersonalEmotes>)
      : undefined;
    const ffzPersonal =
      this.#loadFFZEmotes && this.#personalEmoteSets.ffz !== null ?
        (fetchAndJson(this.#personalEmoteSets.ffz) as Promise<FFZPersonalEmotes>)
      : undefined;

    this.#bttvPersonal = await bttvPersonal;
    this.#ffzPersonal = await ffzPersonal;
  }

  public addSevenTVEmoteNotInSet(sevenTVEmoteNotInSet: SevenTVEmoteNotInSet): void {
    this.#addedEmotes?.push(sevenTVEmoteNotInSet);
  }

  public removeSevenTVEmoteNotInSet(addedEmote: AddedEmote): void {
    const { alias } = addedEmote;
    if (this.#addedEmotes === undefined) return;
    if (alias === null) return;

    const toRemoveIndex = this.#addedEmotes.findIndex(
      (sevenTVEmoteNotInSet_) => sevenTVEmoteNotInSet_.name === alias
    );
    if (toRemoveIndex === -1) return;

    this.#addedEmotes.splice(toRemoveIndex, 1);
  }

  async #refreshAddedEmotes(): Promise<void> {
    const globalEmoteMatcherConstructor = GlobalEmoteMatcherConstructor.instance;

    const addedEmotes = globalEmoteMatcherConstructor.addedEmotesDatabase.getAll(this.#guildId);
    const sevenTVEmoteNotInSets = await (async (): Promise<SevenTVEmoteNotInSet[]> => {
      const sevenTVEmoteNotInSets_ = (
        await Promise.all(
          addedEmotes.map(
            async (addedEmote) => fetchAndJson(addedEmote.url) as Promise<SevenTVEmoteNotInSet>
          )
        )
      ).map((sevenTVEmoteNotInSet, index) => {
        const { alias } = addedEmotes[index];

        if (alias !== null) return { ...sevenTVEmoteNotInSet, name: alias };
        else return sevenTVEmoteNotInSet;
      });

      return sevenTVEmoteNotInSets_;
    })();

    this.#addedEmotes = sevenTVEmoteNotInSets;
  }
}
