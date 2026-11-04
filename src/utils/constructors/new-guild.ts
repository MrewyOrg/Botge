/** @format */

import type { DatabaseManager } from '../../modules/bot/database-manager.ts';
import type { ApiManager } from '../../modules/bot/api-manager.ts';

import { PersonalEmoteMatcherConstructor } from '../../modules/emote-matcher/emote-matcher-constructor.ts';

import type { PersonalEmoteSets } from '../../modules/emote-matcher/personal-emote-sets.ts';

import { Guild } from '../../modules/discord/guild.ts';

export async function newGuild(
  guildId: string,
  broadcasterName: string | null,
  personalEmoteSets: PersonalEmoteSets | undefined,
  databaseManager: Readonly<DatabaseManager>,
  apiManager: Readonly<ApiManager>,
  loadBTTVEmotes: boolean,
  loadFFZEmotes: boolean
): Promise<Readonly<Guild>> {
  const { permittedRoleIdsDatabase, addedEmotesDatabase } = databaseManager;
  const { twitchClipsMeilisearch } = apiManager;

  permittedRoleIdsDatabase.createTable(guildId);
  addedEmotesDatabase.createTable(guildId);

  const settingsPermittedRoleIds = permittedRoleIdsDatabase.getSettingsPermittedRoleIds(guildId);
  const addEmotePermittedRoleIds = permittedRoleIdsDatabase.getAddEmotePermittedRoleIds(guildId);
  const addEmotePermitNoRole = permittedRoleIdsDatabase.getAddEmotePermitNoRole(guildId);

  const personalEmoteMatcherConstructor = PersonalEmoteMatcherConstructor.create(
    guildId,
    personalEmoteSets,
    loadBTTVEmotes,
    loadFFZEmotes
  );
  const emoteMatcher = (await personalEmoteMatcherConstructor).constructEmoteMatcher();
  const twitchClipsMeilisearchIndex = twitchClipsMeilisearch?.getOrCreateIndex(guildId);

  return new Guild(
    guildId,
    broadcasterName,
    await twitchClipsMeilisearchIndex,
    await emoteMatcher,
    await personalEmoteMatcherConstructor,
    settingsPermittedRoleIds,
    addEmotePermittedRoleIds,
    addEmotePermitNoRole
  );
}
