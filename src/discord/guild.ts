import { type ClipIndex, getClipMetadata, refreshClipIndex } from '../api/twitch/clip-index.ts';
import { listCutedogClipIds } from '../api/twitch/list-cutedog-clip-ids.ts';
import type { TwitchApi } from '../api/twitch/twitch-api.ts';
import type { EmoteCatalog } from '../emotes/emote-catalog.ts';
import type { PersonalEmoteStore } from '../emotes/emote-store.ts';
import type { PersonalEmoteSets } from '../emotes/personal-emote-sets.ts';

export const GUILD_ID_CUTEDOG = '251211223012474880' as const;

export class Guild {
  readonly #id: string;
  #broadcasterName: string | null;
  readonly #emoteCatalog: Readonly<EmoteCatalog>;
  readonly #twitchClipsMeilisearchIndex: ClipIndex | undefined;
  readonly #personalEmoteStore: Readonly<PersonalEmoteStore>;
  #uniqueCreatorNames: readonly string[];
  #uniqueGameIds: readonly string[];
  #settingsPermittedRoleIds: readonly string[] | null;
  #addEmotePermittedRoleIds: readonly string[] | null;
  #allowEveryoneToAddEmote: boolean;
  #clipRefresh: Promise<void> | undefined;

  public constructor(
    id: string,
    broadcasterName: string | null,
    twitchClipsMeilisearchIndex: ClipIndex | undefined,
    emoteCatalog: Readonly<EmoteCatalog>,
    emoteStore: Readonly<PersonalEmoteStore>,
    settingsPermittedRoleIds: readonly string[] | null,
    addEmotePermittedRoleIds: readonly string[] | null,
    allowEveryoneToAddEmote: boolean
  ) {
    this.#id = id;
    this.#broadcasterName = broadcasterName;
    this.#twitchClipsMeilisearchIndex = twitchClipsMeilisearchIndex;
    this.#emoteCatalog = emoteCatalog;
    this.#personalEmoteStore = emoteStore;
    this.#uniqueCreatorNames = [];
    this.#uniqueGameIds = [];
    this.#settingsPermittedRoleIds =
      settingsPermittedRoleIds !== null && settingsPermittedRoleIds.length > 0 ?
        [...settingsPermittedRoleIds]
      : null;
    this.#addEmotePermittedRoleIds =
      addEmotePermittedRoleIds !== null && addEmotePermittedRoleIds.length > 0 ?
        [...addEmotePermittedRoleIds]
      : null;
    this.#allowEveryoneToAddEmote = allowEveryoneToAddEmote;
  }

  public get id(): string {
    return this.#id;
  }
  public get broadcasterName(): string | null {
    return this.#broadcasterName;
  }
  public get emoteCatalog(): Readonly<EmoteCatalog> {
    return this.#emoteCatalog;
  }
  public get twitchClipsMeilisearchIndex(): ClipIndex | undefined {
    return this.#twitchClipsMeilisearchIndex;
  }
  public get personalEmoteStore(): Readonly<PersonalEmoteStore> {
    return this.#personalEmoteStore;
  }
  public get uniqueCreatorNames(): readonly string[] {
    return this.#uniqueCreatorNames;
  }
  public get uniqueGameIds(): readonly string[] {
    return this.#uniqueGameIds;
  }

  public get settingsPermittedRoleIds(): readonly string[] | null {
    return this.#settingsPermittedRoleIds;
  }

  public get addEmotePermittedRoleIds(): readonly string[] | null {
    return this.#addEmotePermittedRoleIds;
  }

  public get allowEveryoneToAddEmote(): boolean {
    return this.#allowEveryoneToAddEmote;
  }

  public changeSettingsPermittedRoleIds(roleIds: readonly string[]): void {
    this.#settingsPermittedRoleIds = roleIds.length === 0 ? null : [...roleIds];
  }

  public changeAddEmotePermittedRoleIds(roleIds: readonly string[]): void {
    this.#addEmotePermittedRoleIds = roleIds.length === 0 ? null : [...roleIds];
  }

  public toggleAllowEveryoneToAddEmote(): void {
    this.#allowEveryoneToAddEmote = !this.#allowEveryoneToAddEmote;
  }

  public async changeBroadcasterNameAndRefreshClips(
    twitchApi: Readonly<TwitchApi> | undefined,
    broadcasterName: string
  ): Promise<void> {
    this.#broadcasterName = broadcasterName;
    await this.refreshClips(twitchApi, true);
  }

  public async changePersonalEmoteSets(personalEmoteSets: PersonalEmoteSets): Promise<void> {
    await this.#personalEmoteStore.changePersonalEmoteSets(personalEmoteSets);
  }

  public async refreshClips(
    twitchApi: Readonly<TwitchApi> | undefined,
    deleteOld = false
  ): Promise<void> {
    const index = this.#twitchClipsMeilisearchIndex;
    if (index === undefined || twitchApi === undefined || this.#broadcasterName === null) return;

    // Settings changes and scheduled refreshes must not write the same index concurrently.
    const refresh = (this.#clipRefresh ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const broadcasterName = this.#broadcasterName;
        if (broadcasterName === null) return;
        const clipIds = this.#id === GUILD_ID_CUTEDOG ? await listCutedogClipIds() : undefined;
        await refreshClipIndex(index, twitchApi, broadcasterName, clipIds, deleteOld);
        await this.refreshUniqueCreatorNamesAndGameIds();
      });
    this.#clipRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.#clipRefresh === refresh) this.#clipRefresh = undefined;
    }
  }

  public async refreshUniqueCreatorNamesAndGameIds(): Promise<void> {
    if (this.#twitchClipsMeilisearchIndex === undefined) return;
    const metadata = await getClipMetadata(this.#twitchClipsMeilisearchIndex);
    // Publish both lists only after all pages have loaded successfully.
    this.#uniqueCreatorNames = metadata.creatorNames;
    this.#uniqueGameIds = metadata.gameIds;
  }
}
