/** @format */

import type { Job } from 'node-schedule';
// import { readFileSync } from 'node:fs';

import { Events, type Client } from 'discord.js';
import { joinVoiceChannel } from '@discordjs/voice';

import { once } from 'helpful-decorators';

import { messageContextMenuCommandHandler } from '../../handlers/interaction-handlers/message-context-menu-command.ts';
import { roleSelectMenuHandler } from '../../handlers/interaction-handlers/role-select-menu.ts';
import { autocompleteHandler } from '../../handlers/interaction-handlers/autocomplete.ts';
import { modalSubmitHandler } from '../../handlers/interaction-handlers/modal-submit.ts';
import { buttonHandler } from '../../handlers/interaction-handlers/button.ts';

import {
  createCommandHandlers,
  type CommandHandler
} from '../../utils/modules/bot/create-command-handlers.ts';
import { newGuild } from '../../utils/constructors/new-guild.ts';
import { logError } from '../../utils/public/log-error.ts';

import { settingsHandler } from '../../handlers/command-handlers/settings.ts';
import { emotesHandler } from '../../handlers/command-handlers/emote.ts';

import { messageCreateHandler } from '../../handlers/message-create-handlers/message-create-handler.ts';

import { SLASH_COMMAND_NAMES } from '../discord/commands.ts';
import { GENERAL_CHANNEL_ID_CUTEDOG, type Guild } from '../discord/guild.ts';
import type { User } from '../discord/user.ts';

import { MessageBuilderManager } from './message-builder-manager.ts';
import type { DatabaseManager } from './database-manager.ts';
import type { ApiManager } from './api-manager.ts';

/**
 * The central class.
 */
export class Bot {
  static #instance: Readonly<Bot> | undefined = undefined;

  readonly #scheduledJobs: Readonly<Job>[] = [];

  readonly #client: Client;

  readonly #commandHandlers: Map<string, CommandHandler>;

  readonly #messageBuilderManager: Readonly<MessageBuilderManager> = new MessageBuilderManager();
  readonly #databaseManager: Readonly<DatabaseManager>;
  readonly #apiManager: Readonly<ApiManager>;

  readonly #guilds: Readonly<Guild>[];
  readonly #users: Readonly<User>[];

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

  public get scheduledJobs(): Readonly<Job>[] {
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
  public get dataBaseManager(): Readonly<DatabaseManager> {
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
  public registerListeners(joinVoiceChannels: boolean): void {
    this.#registerClientReadyListener(joinVoiceChannels);
    this.#registerMessageCreateListener();
    this.#registerInteractionCreateListener();
  }

  #registerClientReadyListener(joinVoiceChannels: boolean): void {
    this.#client.on(Events.ClientReady, (): void => {
      const { user, channels } = this.#client;
      if (user === null) throw new Error('Bot client user is empty.');

      user.setStatus('online');
      user.setPresence({ activities: [{ name: 'github.com/MrewyOrg/Botge', state: 'meow' }] });

      /*
      try {
        const banner = readFileSync('assets/banner.webp');
        void user.setBanner(banner);
      } catch (error) {
        logError(error, 'Error at setting bot banner');
      }
      */

      try {
        if (joinVoiceChannels) {
          const cuteDogGeneralChannel = channels.cache.find(
            (channel: { readonly id: string }) => channel.id === GENERAL_CHANNEL_ID_CUTEDOG
          );

          if (
            cuteDogGeneralChannel !== undefined
            && cuteDogGeneralChannel.isVoiceBased()
            && cuteDogGeneralChannel.joinable
          ) {
            joinVoiceChannel({
              channelId: cuteDogGeneralChannel.id,
              guildId: cuteDogGeneralChannel.guild.id,
              adapterCreator: cuteDogGeneralChannel.guild.voiceAdapterCreator,
              selfDeaf: true,
              selfMute: true
            });
          }
        }
      } catch (error) {
        logError(error, 'Error at joining voice channel');
      }

      console.log(`Logged in as ${user.tag}!`);
    });
  }

  #registerMessageCreateListener(): void {
    this.#client.on(Events.MessageCreate, async (message): Promise<void> => {
      const { guildId } = message;
      if (guildId === null || message.author.bot) return;

      const guild =
        this.#guilds.find((guild_) => guild_.id === guildId)
        ?? (await (async (): Promise<Readonly<Guild>> => {
          const newGuildWithoutPersonalEmotes_ = await newGuild(
            guildId,
            null,
            undefined,
            this.#databaseManager,
            this.#apiManager,
            true,
            true
          );
          this.#guilds.push(newGuildWithoutPersonalEmotes_);

          return newGuildWithoutPersonalEmotes_;
        })());

      void messageCreateHandler(this.#client.user?.id ?? null)(
        this.#apiManager.cachedUrl,
        message,
        guild,
        this.#users,
        this.#databaseManager.mediaDatabase
      );
    });
  }

  #registerInteractionCreateListener(): void {
    this.#client.on(Events.InteractionCreate, async (interaction): Promise<void> => {
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
          const guild_ =
            this.#guilds.find((guildge) => guildge.id === guildId)
            ?? (await (async (): Promise<Readonly<Guild>> => {
              const newGuildWithoutPersonalEmotes_ = await newGuild(
                guildId,
                null,
                undefined,
                this.#databaseManager,
                this.#apiManager,
                true,
                true
              );
              this.#guilds.push(newGuildWithoutPersonalEmotes_);

              return newGuildWithoutPersonalEmotes_;
            })());

          return guild_;
        }

        const guildId_ = ((): string | undefined => {
          const user_ = this.#users.find((userge) => userge.id === interaction.user.id);
          if (user_ === undefined) return undefined;
          return user_.guild?.id;
        })();
        if (guildId_ === undefined) return undefined;
        const guild_ = this.#guilds.find((guildge) => guildge.id === guildId_);
        // there cannot be a case when we found a guildId from a user and we would need to create a guild without personal emotes
        if (guild_ === undefined) throw new Error("Couldn't find guild.");
        return guild_;
      })();

      if (interaction.isModalSubmit()) {
        void modalSubmitHandler(
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
        const { emoteMatcher, twitchClipsMeilisearchIndex, uniqueCreatorNames, uniqueGameIds } =
          guild;

        void autocompleteHandler(
          emoteMatcher,
          twitchClipsMeilisearchIndex,
          uniqueCreatorNames,
          uniqueGameIds,
          this.#databaseManager
        )(interaction);
        return;
      }

      if (interaction.isRoleSelectMenu()) {
        if (guild === undefined) return;
        void roleSelectMenuHandler(guild, this.#databaseManager)(interaction);
        return;
      }

      if (interaction.isButton()) {
        const user_ = this.#users.find((userge) => userge.id === interaction.user.id);

        const emoteMessageBuilder = await buttonHandler(
          this.#client,
          guild,
          user_,
          this.#messageBuilderManager,
          this.#databaseManager
        )(interaction);

        if (emoteMessageBuilder !== undefined)
          this.#messageBuilderManager.emoteMessageBuilders.push(emoteMessageBuilder);
        return;
      }

      if (interaction.isMessageContextMenuCommand()) {
        void messageContextMenuCommandHandler(this.#databaseManager, this.#apiManager)(interaction);
        return;
      }

      if (interaction.commandName === SLASH_COMMAND_NAMES.settings) {
        void settingsHandler()(interaction, guild);
        return;
      }

      if (guild === undefined) return;

      if (interaction.commandName === SLASH_COMMAND_NAMES.emote) {
        void emotesHandler(this.#apiManager.cachedUrl)(guild, this.#users, true, interaction);
        return;
      }

      if (interaction.commandName === SLASH_COMMAND_NAMES.emotes) {
        void emotesHandler(this.#apiManager.cachedUrl)(guild, this.#users, false, interaction);
        return;
      }

      const commandHandler = this.#commandHandlers.get(interaction.commandName);
      if (commandHandler === undefined) return;
      void commandHandler(interaction, guild);
      // TODO: error handling

      return;
    });
  }
}
