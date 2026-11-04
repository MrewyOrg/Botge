/** @format */

import type { TwitchClipsMeilisearch } from '../../api/twitch-clips-meilisearch.ts';
// import type { RedditApi } from '../api/reddit-api.ts';
import type { TwitchApi } from '../../api/twitch-api.ts';
import type { CachedUrl } from '../../api/cached-url.ts';

import type { ReadonlyDeepLClient, ReadonlyOpenAI } from '../../types.ts';

export class ApiManager {
  readonly #twitchClipsMeilisearch: Readonly<TwitchClipsMeilisearch> | undefined;
  // readonly #redditApi: Readonly<RedditApi> | undefined;
  readonly #twitchApi: Readonly<TwitchApi> | undefined;
  readonly #cachedUrl: Readonly<CachedUrl>;
  readonly #deepLClient: ReadonlyDeepLClient | undefined;
  readonly #openai: ReadonlyOpenAI | undefined;

  public constructor(
    twitchClipsMeiliSearch: Readonly<TwitchClipsMeilisearch> | undefined,
    // redditApi: Readonly<RedditApi> | undefined,
    twitchApi: Readonly<TwitchApi> | undefined,
    cachedUrl: Readonly<CachedUrl>,
    deepLClient: ReadonlyDeepLClient | undefined,
    openai: ReadonlyOpenAI | undefined
  ) {
    this.#twitchClipsMeilisearch = twitchClipsMeiliSearch;
    /// this.#redditApi = redditApi;
    this.#twitchApi = twitchApi;
    this.#cachedUrl = cachedUrl;
    this.#deepLClient = deepLClient;
    this.#openai = openai;
  }

  public get twitchClipsMeilisearch(): Readonly<TwitchClipsMeilisearch> | undefined {
    return this.#twitchClipsMeilisearch;
  }
  /*
  public get redditApi(): Readonly<RedditApi> | undefined {
    return this.#redditApi;
  }
  */
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
