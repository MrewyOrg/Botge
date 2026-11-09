import { ChannelType, type Client, type ClientEvents, Events } from 'discord.js';
import { once } from 'helpful-decorators';
import type { Job } from 'node-schedule';

import { SLASH_COMMAND_NAMES } from '../discord/command-names.ts';
import type { Guild } from '../discord/guild.ts';
import { newGuild } from '../discord/new-guild.ts';
import type { User } from '../discord/user.ts';
import { requestVoiceChannelJoin, setVoiceChannelStatus } from '../discord/voice-channel.ts';
import { emotesHandler } from '../handlers/commands/emote.ts';
import { settingsHandler } from '../handlers/commands/settings.ts';
import { autocompleteHandler } from '../handlers/interactions/autocomplete.ts';
import { buttonHandler } from '../handlers/interactions/button.ts';
import { messageContextMenuCommandHandler } from '../handlers/interactions/message-context-menu-command.ts';
import { modalSubmitHandler } from '../handlers/interactions/modal-submit.ts';
import { roleSelectMenuHandler } from '../handlers/interactions/role-select-menu.ts';
import { messageCreateHandler } from '../handlers/messages/message-create.ts';
import type { MutableArray } from '../types.ts';
import { logError } from '../utils/log-error.ts';
import type { ApiManager } from './api-manager.ts';
import { type CommandHandler, createCommandHandlers } from './create-command-handlers.ts';
import type { DatabaseManager } from './database-manager.ts';
import { MessageBuilderManager, registerMessageBuilder } from './message-builder-manager.ts';

/**
 * The central class.
 */
export class Bot {
  static #instance: Readonly<Bot> | undefined = undefined;

  readonly #scheduledJobs: MutableArray<Readonly<Job>> = [];

  readonly #client: Client;

  readonly #commandHandlers: ReadonlyMap<string, CommandHandler>;

  readonly #messageBuilderManager: Readonly<MessageBuilderManager> = new MessageBuilderManager();
  readonly #databaseManager: Readonly<DatabaseManager>;
  readonly #apiManager: Readonly<ApiManager>;

  readonly #guilds: MutableArray<Readonly<Guild>>;
  readonly #pendingGuilds = new Map<string, Promise<Readonly<Guild>>>();
  readonly #users: MutableArray<Readonly<User>>;

  private constructor(
    client: Client,
    apiManager: Readonly<ApiManager>,
    databaseManager: Readonly<DatabaseManager>,
    guilds: readonly Readonly<Guild>[],
    users: readonly Readonly<User>[]
  ) {
    this.#client = client;

    this.#apiManager = apiManager;
    this.#databaseManager = databaseManager;

    this.#commandHandlers = createCommandHandlers(
      this.#scheduledJobs,
      this.#client,
      this.#messageBuilderManager,
      this.#databaseManager,
      this.#apiManager
    );

    this.#guilds = [...guilds];
    this.#users = [...users];
  }

  public static get instance(): Readonly<Bot> {
    if (Bot.#instance === undefined) throw new Error('Bot instance not created.');

    return Bot.#instance;
  }

  public get scheduledJobs(): MutableArray<Readonly<Job>> {
    return this.#scheduledJobs;
  }
  public get client(): Client {
    return this.#client;
  }
  public get guilds(): readonly Readonly<Guild>[] {
    return this.#guilds;
  }
  public get messageBuilderManager(): Readonly<MessageBuilderManager> {
    return this.#messageBuilderManager;
  }
  public get databaseManager(): Readonly<DatabaseManager> {
    return this.#databaseManager;
  }
  public get apiManager(): Readonly<ApiManager> {
    return this.#apiManager;
  }

  @once
  public static createInstance(
    client: Client,
    apiManager: Readonly<ApiManager>,
    databaseManager: Readonly<DatabaseManager>,
    guilds: readonly Readonly<Guild>[],
    users: readonly Readonly<User>[]
  ): void {
    Bot.#instance = new Bot(client, apiManager, databaseManager, guilds, users);
  }

  @once
  public registerListeners(): void {
    this.#registerClientReadyListener();
    this.#registerMessageCreateListener();
    this.#registerInteractionCreateListener();
    this.#registerVoiceStatusListener();
    this.#client.on(Events.GuildDelete, (guild: Readonly<{ id: string }>): void => {
      this.#releaseGuild(guild.id);
    });
  }

  #registerClientReadyListener(): void {
    this.#client.on(Events.ClientReady, (): void => {
      const { user } = this.#client;
      if (user === null) throw new Error('Bot client user is empty.');

      for (const guild of [...this.#guilds]) {
        if (!this.#client.guilds.cache.has(guild.id)) this.#releaseGuild(guild.id);
      }

      const { voiceChannelsDatabase } = this.#databaseManager.databases;
      for (const guild of this.#client.guilds.cache.values()) {
        try {
          const channelId = voiceChannelsDatabase.getChannelId(guild.id);
          if (channelId === undefined) continue;

          const channel = guild.channels.cache.get(channelId);
          if (channel?.type === ChannelType.GuildVoice && channel.joinable)
            requestVoiceChannelJoin(channel);
        } catch (error) {
          logError(error, `Error restoring voice channel for guild ${guild.id}`);
        }
      }

      console.log(`Logged in as ${user.tag}!`);
    });
  }

  #registerVoiceStatusListener(): void {
    this.#client.on(
      Events.VoiceStateUpdate,
      (
        previous: Readonly<{ channelId: string | null }>,
        current: Readonly<{ channelId: string | null; id: string; guild: Readonly<{ id: string }> }>
      ): void => {
        const { channelId, guild, id } = current;
        if (id !== this.#client.user?.id || channelId === null || channelId === previous.channelId)
          return;

        const setStatus = async (): Promise<void> => {
          const { voiceChannelsDatabase } = this.#databaseManager.databases;
          if (voiceChannelsDatabase.getChannelId(guild.id) !== channelId) return;

          const { enabled, emoji } = voiceChannelsDatabase.getStatusSettings(guild.id);
          if (enabled && emoji !== null)
            await setVoiceChannelStatus(this.#client.rest, channelId, emoji);
        };

        void setStatus().catch((error: unknown): void => {
          logError(error, `Error setting voice channel status for guild ${guild.id}`);
        });
      }
    );
  }

  async #getOrCreateGuild(guildId: string): Promise<Readonly<Guild>> {
    const existingGuild = this.#guilds.find((guild) => guild.id === guildId);
    if (existingGuild !== undefined) return existingGuild;

    const pendingGuild = this.#pendingGuilds.get(guildId);
    if (pendingGuild !== undefined) return pendingGuild;

    const creation: Promise<Readonly<Guild>> = newGuild(
      guildId,
      null,
      undefined,
      this.#databaseManager,
      this.#apiManager
    )
      .then((guild) => {
        if (this.#pendingGuilds.get(guildId) !== creation) {
          guild.personalEmoteStore.dispose();
          throw new Error('Guild initialization was cancelled.');
        }
        this.#guilds.push(guild);
        for (const user of this.#users) {
          if (user.guildId === guildId) user.changeGuild(guild);
        }
        return guild;
      })
      .finally(() => {
        if (this.#pendingGuilds.get(guildId) === creation) this.#pendingGuilds.delete(guildId);
      });
    this.#pendingGuilds.set(guildId, creation);
    return creation;
  }

  #releaseGuild(guildId: string): void {
    this.#pendingGuilds.delete(guildId);
    const index = this.#guilds.findIndex((guild) => guild.id === guildId);
    if (index !== -1) {
      const [guild] = this.#guilds.splice(index, 1);
      try {
        guild?.personalEmoteStore.dispose();
      } catch (error) {
        logError(error, 'Error releasing guild emotes');
      }
    }
    for (const user of this.#users) {
      if (user.guildId === guildId) user.releaseGuild();
    }
    this.#apiManager.twitchClipsMeilisearch?.releaseIndex(guildId);
  }

  #registerMessageCreateListener(): void {
    const handleMessage = async (message: ClientEvents[Events.MessageCreate][0]): Promise<void> => {
      try {
        const { guildId } = message;
        if (guildId === null || message.author.bot) return;

        const guild = await this.#getOrCreateGuild(guildId);

        await messageCreateHandler(this.#client.user?.id ?? null)(
          this.#apiManager.cachedUrl,
          message,
          guild,
          this.#users,
          this.#databaseManager.mediaDatabase
        );
      } catch (error) {
        logError(error, 'Error handling message');
      }
    };
    this.#client.on(Events.MessageCreate, (message): void => {
      void handleMessage(message);
    });
  }

  #registerInteractionCreateListener(): void {
    const handleInteraction = async (
      interaction: ClientEvents[Events.InteractionCreate][0]
    ): Promise<void> => {
      try {
        // not interaction
        if (
          !interaction.isChatInputCommand()
          && !interaction.isButton()
          && !interaction.isAutocomplete()
          && !interaction.isModalSubmit()
          && !interaction.isRoleSelectMenu()
          && !interaction.isMessageContextMenuCommand()
        )
          return;

        const { guildId, user } = interaction;
        if (user.bot) return;

        const guild = await (async (): Promise<Readonly<Guild> | undefined> => {
          if (guildId !== null) {
            return this.#getOrCreateGuild(guildId);
          }

          const assignedGuildId = ((): string | undefined => {
            const selectedUser = this.#users.find(
              (candidateUser) => candidateUser.id === interaction.user.id
            );
            if (selectedUser === undefined) return undefined;
            return selectedUser.guildId;
          })();
          if (assignedGuildId === undefined) return undefined;
          const assignedGuild = this.#guilds.find(
            (candidateGuild) => candidateGuild.id === assignedGuildId
          );
          return assignedGuild;
        })();

        if (interaction.isModalSubmit()) {
          await modalSubmitHandler(
            this.#guilds,
            this.#users,
            guild,
            this.#messageBuilderManager,
            this.#databaseManager,
            this.#apiManager
          )(interaction);
          return;
        }

        if (interaction.isAutocomplete()) {
          if (guild === undefined) return;
          const { emoteCatalog, twitchClipsMeilisearchIndex, uniqueCreatorNames, uniqueGameIds } =
            guild;

          await autocompleteHandler(
            emoteCatalog,
            twitchClipsMeilisearchIndex,
            uniqueCreatorNames,
            uniqueGameIds,
            this.#databaseManager
          )(interaction);
          return;
        }

        if (interaction.isRoleSelectMenu()) {
          if (guild === undefined) return;
          await roleSelectMenuHandler(guild, this.#databaseManager)(interaction);
          return;
        }

        if (interaction.isButton()) {
          const selectedUser = this.#users.find(
            (candidateUser) => candidateUser.id === interaction.user.id
          );

          const emoteMessageBuilder = await buttonHandler(
            this.#client,
            guild,
            selectedUser,
            this.#messageBuilderManager,
            this.#databaseManager
          )(interaction);

          if (emoteMessageBuilder !== undefined)
            registerMessageBuilder(
              this.#messageBuilderManager.emoteMessageBuilders,
              emoteMessageBuilder
            );
          return;
        }

        if (interaction.isMessageContextMenuCommand()) {
          await messageContextMenuCommandHandler(
            this.#databaseManager,
            this.#apiManager
          )(interaction);
          return;
        }

        if (interaction.commandName === SLASH_COMMAND_NAMES.settings) {
          await settingsHandler()(interaction, guild);
          return;
        }

        if (guild === undefined) return;

        if (interaction.commandName === SLASH_COMMAND_NAMES.emote) {
          await emotesHandler(this.#apiManager.cachedUrl)(guild, this.#users, true, interaction);
          return;
        }

        if (interaction.commandName === SLASH_COMMAND_NAMES.emotes) {
          await emotesHandler(this.#apiManager.cachedUrl)(guild, this.#users, false, interaction);
          return;
        }

        const commandHandler = this.#commandHandlers.get(interaction.commandName);
        if (commandHandler === undefined) return;
        await commandHandler(interaction, guild);
      } catch (error) {
        logError(error, 'Error handling interaction');
      }
    };
    this.#client.on(Events.InteractionCreate, (interaction): void => {
      void handleInteraction(interaction);
    });
  }
}
