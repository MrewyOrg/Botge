// Copyright (c) 2026 MrewyOrg. Licensed under the MIT license.
// See LICENSE.txt in the project root for license information.

/**
 * Search emotes, clips, use zero-width emotes and other such commands.
 *
 * @remarks
 * Initializes the {@link Bot} object, registers its listeners and starts it.
 *
 * @packageDocumentation
 */

import { DeepLClient } from 'deepl-node';
import { Meilisearch } from 'meilisearch';
import OpenAI from 'openai';

import { CachedUrl } from './api/cached-url.ts';
import { newTwitchApi } from './api/twitch/new-twitch-api.ts';
import type { TwitchApi } from './api/twitch/twitch-api.ts';
import { TwitchClipsMeilisearch } from './api/twitch/twitch-clips-meilisearch.ts';
import { ApiManager } from './bot/api-manager.ts';
import { Bot } from './bot/bot.ts';
import { createDiscordClient } from './bot/create-discord-client.ts';
import { DatabaseManager } from './bot/database-manager.ts';
import { createShutdown, prepareDirectories, scheduleTask } from './bot/lifecycle.ts';
import { registerPings } from './bot/register-pings.ts';
import { botgeConfig } from './config/botge-config.ts';
import { DATABASE_DIR, TMP_DIR } from './config/directory-paths.ts';
import { openDatabases } from './database/open-databases.ts';
import type { Guild } from './discord/guild.ts';
import { newGuild } from './discord/new-guild.ts';
import { updateCommands } from './discord/update-commands.ts';
import { User } from './discord/user.ts';
import { GlobalEmoteStore } from './emotes/emote-store.ts';
import { sevenTVEvents } from './emotes/seventv/event-client.ts';
import type { ReadonlyDeepLClient, ReadonlyOpenAI } from './types.ts';
import { logError } from './utils/log-error.ts';

/** Construct long-lived callbacks separately from temporary startup snapshots. */
function scheduleMaintenance(bot: Readonly<Bot>, twitchApi: Readonly<TwitchApi> | undefined): void {
  scheduleTask('cleanup-message-builders', '0 */4 * * * *', () => {
    bot.messageBuilderManager.cleanupMessageBuilders();
  });
  // Refresh tokens at minute 54, ahead of the next hour and the API request timeout.
  scheduleTask('refresh-twitch-token', '0 54 * * * *', async () => {
    await twitchApi?.validateAndGetNewAccessTokenIfInvalid();
  });
  scheduleTask('refresh-clips', '0 */2 * * *', async () => {
    await Promise.all(
      bot.guilds.map(async (guild) => {
        try {
          await guild.refreshClips(twitchApi);
        } catch (error) {
          logError(error, `Error refreshing clips for guild ${guild.id}`);
        }
      })
    );
  });
  scheduleTask('refresh-personal-emotes', '6 */6 * * *', async () => {
    await Promise.all(
      bot.guilds.map(async (guild) => {
        try {
          await guild.personalEmoteStore.refreshBTTVAndFFZPersonalEmotes();
        } catch (error) {
          logError(error, `Error refreshing personal emotes for guild ${guild.id}`);
        }
      })
    );
  });
  scheduleTask('refresh-global-emotes', '12 */12 * * *', async () => {
    await GlobalEmoteStore.instance.refreshGlobalEmotes();
  });
}

/** Construct services and run the application; importing this module has no startup side effects. */
export async function startApplication(): Promise<void> {
  process.env['AUTOCOMPLETE_ONLY_7TV_PERSONAL'] = String(
    botgeConfig.general.autoCompleteOnly7TVPersonal
  );

  const COMMANDS_PATH = `${DATABASE_DIR}/commands.txt` as const;

  /** Read consumed credentials once so command registration and login share the same token. */
  function takeEnvironmentVariable(name: string): string | undefined {
    const value = process.env[name]?.trim();
    Reflect.deleteProperty(process.env, name);
    return value === '' ? undefined : value;
  }

  const client = createDiscordClient();
  let activeDatabases: Readonly<DatabaseManager> | undefined;
  let databasesClosed = false;
  let stopping = false;

  function isStopping(): boolean {
    return stopping;
  }

  function closeDatabases(): void {
    if (databasesClosed) return;
    databasesClosed = true;
    try {
      activeDatabases?.closeDatabases();
    } catch (error) {
      logError(error, 'Error closing databases');
    }
  }

  const shutdown = createShutdown(client, () => {
    sevenTVEvents.close();
    closeDatabases();
  });

  async function stop(exitCode: number): Promise<void> {
    if (exitCode !== 0) process.exitCode = exitCode;
    if (isStopping()) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    await shutdown();
    clearTimeout(timeout);
    process.exit(process.exitCode ?? exitCode);
  }

  process.once('SIGINT', () => {
    void stop(0);
  });
  process.once('SIGTERM', () => {
    void stop(0);
  });
  process.once('exit', closeDatabases);
  // Observe fatal errors without overriding Node's normal nonzero exit behavior.
  process.on('uncaughtExceptionMonitor', (error: Readonly<Error>, origin) => {
    logError(error, origin);
  });

  async function main(): Promise<void> {
    const applicationId = takeEnvironmentVariable('APP_ID');
    const discordToken = takeEnvironmentVariable('DISCORD_TOKEN');
    if (applicationId === undefined || discordToken === undefined)
      throw new Error('APP_ID and DISCORD_TOKEN are required.');

    await prepareDirectories(DATABASE_DIR, TMP_DIR);
    if (isStopping()) return;

    const openaiApiKey = takeEnvironmentVariable('OPENAI_API_KEY');
    const deepLApiKey = takeEnvironmentVariable('DEEPL_API_KEY');
    const twitchClientId = takeEnvironmentVariable('TWITCH_CLIENT_ID');
    const twitchSecret = takeEnvironmentVariable('TWITCH_SECRET');
    const meilisearchHost = takeEnvironmentVariable('MEILISEARCH_HOST');
    const meiliMasterKey = takeEnvironmentVariable('MEILI_MASTER_KEY');
    const localCacheBase = takeEnvironmentVariable('LOCAL_CACHE_BASE');
    // Optional external services.
    const twitchClipsMeilisearch: Readonly<TwitchClipsMeilisearch> | undefined =
      meilisearchHost !== undefined && meiliMasterKey !== undefined ?
        new TwitchClipsMeilisearch(
          new Meilisearch({ host: meilisearchHost, apiKey: meiliMasterKey })
        )
      : undefined;

    const twitchApi =
      twitchClientId !== undefined && twitchSecret !== undefined ?
        await newTwitchApi(twitchClientId, twitchSecret)
      : undefined;

    if (isStopping()) return;

    const cachedUrl: Readonly<CachedUrl> = new CachedUrl(localCacheBase);

    const deepLClient: ReadonlyDeepLClient | undefined =
      deepLApiKey !== undefined ? new DeepLClient(deepLApiKey) : undefined;
    const openai: ReadonlyOpenAI | undefined =
      openaiApiKey !== undefined ? new OpenAI({ apiKey: openaiApiKey }) : undefined;

    const apiManager: Readonly<ApiManager> = new ApiManager(
      twitchClipsMeilisearch,
      twitchApi,
      cachedUrl,
      deepLClient,
      openai
    );

    // The registry owns file paths and closes partially opened connections on failure.
    const databaseManager = new DatabaseManager(openDatabases(DATABASE_DIR));
    activeDatabases = databaseManager;
    const {
      broadcasterNameAndPersonalEmoteSetsDatabase,
      addedEmotesDatabase,
      usersDatabase,
      pingsDatabase
    } = databaseManager.databases;

    // Global emotes must be initialized before guild matchers.
    await GlobalEmoteStore.createInstance(twitchApi, addedEmotesDatabase, botgeConfig.general);

    if (isStopping()) return;

    const storedUsers = usersDatabase.getAllUsers();
    const guildSettings =
      broadcasterNameAndPersonalEmoteSetsDatabase.getAllBroadcasterNamesAndPersonalEmoteSets();
    const guildIds = new Set(guildSettings.keys());
    for (const user of storedUsers) {
      if (user.guildId !== null) guildIds.add(user.guildId);
    }
    const guilds: readonly Readonly<Guild>[] = await Promise.all(
      [...guildIds].map(async (guildId) => {
        const settings = guildSettings.get(guildId);
        return newGuild(guildId, settings?.[0] ?? null, settings?.[1], databaseManager, apiManager);
      })
    );

    if (isStopping()) return;

    // Restore personal settings and their associated guilds.
    const users: readonly Readonly<User>[] = storedUsers.map((databaseUser) => {
      const { guildId } = databaseUser;
      const enableEmoteBorder =
        databaseUser.enableEmoteBorder !== null ?
          Boolean(databaseUser.enableEmoteBorder)
        : undefined;
      const emoteBorderColor = databaseUser.emoteBorderColor ?? undefined;

      if (guildId === null)
        return new User(databaseUser.userId, undefined, enableEmoteBorder, emoteBorderColor);

      const guild = guilds.find((candidateGuild) => candidateGuild.id === guildId);
      if (guild === undefined)
        throw new Error('Undefined guild while searching for guild for user.');

      return new User(databaseUser.userId, guild, enableEmoteBorder, emoteBorderColor);
    });

    Bot.createInstance(client, apiManager, databaseManager, guilds, users);
    const bot = Bot.instance;
    bot.registerListeners();
    await updateCommands(
      COMMANDS_PATH,
      botgeConfig.general.activeSlashCommands,
      botgeConfig.general.activeContextMenuCommands,
      applicationId,
      discordToken
    );
    if (isStopping()) return;

    await Promise.all(
      bot.guilds.map(async (guild) => {
        try {
          if (botgeConfig.general.updateClipsOnStartup) await guild.refreshClips(twitchApi);
          else await guild.refreshUniqueCreatorNamesAndGameIds();
        } catch (error) {
          logError(error, `Error loading clips for guild ${guild.id}`);
        }
      })
    );
    if (isStopping()) return;

    await client.login(discordToken);
    if (isStopping()) return;
    await registerPings(client, pingsDatabase, bot.scheduledJobs);
    if (isStopping()) return;

    scheduleMaintenance(bot, twitchApi);
  }

  try {
    await main();
  } catch (error) {
    logError(error, 'Failed to start Botge');
    await stop(1);
  }
}
