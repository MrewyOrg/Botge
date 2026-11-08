import type { CachedUrl } from '../api/cached-url.ts';
import type { TwitchApi } from '../api/twitch/twitch-api.ts';
import type { TwitchClipsMeilisearch } from '../api/twitch/twitch-clips-meilisearch.ts';
import type { ReadonlyDeepLClient, ReadonlyOpenAI } from '../types.ts';

export class ApiManager {
  readonly #twitchClipsMeilisearch: Readonly<TwitchClipsMeilisearch> | undefined;
  readonly #twitchApi: Readonly<TwitchApi> | undefined;
  readonly #cachedUrl: Readonly<CachedUrl>;
  readonly #deepLClient: ReadonlyDeepLClient | undefined;
  readonly #openai: ReadonlyOpenAI | undefined;

  public constructor(
    twitchClipsMeilisearch: Readonly<TwitchClipsMeilisearch> | undefined,
    twitchApi: Readonly<TwitchApi> | undefined,
    cachedUrl: Readonly<CachedUrl>,
    deepLClient: ReadonlyDeepLClient | undefined,
    openai: ReadonlyOpenAI | undefined
  ) {
    this.#twitchClipsMeilisearch = twitchClipsMeilisearch;
    this.#twitchApi = twitchApi;
    this.#cachedUrl = cachedUrl;
    this.#deepLClient = deepLClient;
    this.#openai = openai;
  }

  public get twitchClipsMeilisearch(): Readonly<TwitchClipsMeilisearch> | undefined {
    return this.#twitchClipsMeilisearch;
  }
  public get twitchApi(): Readonly<TwitchApi> | undefined {
    return this.#twitchApi;
  }
  public get cachedUrl(): Readonly<CachedUrl> {
    return this.#cachedUrl;
  }
  public get deepLClient(): ReadonlyDeepLClient | undefined {
    return this.#deepLClient;
  }
  public get openai(): ReadonlyOpenAI | undefined {
    return this.#openai;
  }
}
