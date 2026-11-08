import type { ApiManager } from '../bot/api-manager.ts';
import type { DatabaseManager } from '../bot/database-manager.ts';
import { PersonalEmoteStore } from '../emotes/emote-store.ts';
import type { PersonalEmoteSets } from '../emotes/personal-emote-sets.ts';
import { Guild } from './guild.ts';

export async function newGuild(
  guildId: string,
  broadcasterName: string | null,
  personalEmoteSets: PersonalEmoteSets | undefined,
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>
): Promise<Readonly<Guild>> {
  const { permittedRoleIdsDatabase, addedEmotesDatabase } = databaseManager;
  const { twitchClipsMeilisearch } = apiManager;

  permittedRoleIdsDatabase.createTable(guildId);
  addedEmotesDatabase.createTable(guildId);

  const settingsPermittedRoleIds = permittedRoleIdsDatabase.getSettingsPermittedRoleIds(guildId);
  const addEmotePermittedRoleIds = permittedRoleIdsDatabase.getAddEmotePermittedRoleIds(guildId);
  const addEmotePermitNoRole = permittedRoleIdsDatabase.getAddEmotePermitNoRole(guildId);

  const [emotes, search] = await Promise.allSettled([
    PersonalEmoteStore.create(guildId, personalEmoteSets),
    twitchClipsMeilisearch?.getOrCreateIndex(guildId)
  ]);
  if (emotes.status === 'rejected') throw emotes.reason as unknown;
  if (search.status === 'rejected') {
    emotes.value.dispose();
    throw search.reason as unknown;
  }
  const personalEmoteStore = emotes.value;
  const twitchClipsMeilisearchIndex = search.value;
  const emoteCatalog = personalEmoteStore.catalog;

  return new Guild(
    guildId,
    broadcasterName,
    twitchClipsMeilisearchIndex,
    emoteCatalog,
    personalEmoteStore,
    settingsPermittedRoleIds,
    addEmotePermittedRoleIds,
    addEmotePermitNoRole
  );
}
