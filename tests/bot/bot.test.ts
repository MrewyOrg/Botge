import { joinVoiceChannel } from '@discordjs/voice';
import { Client, type ClientUser, Events, type VoiceChannel } from 'discord.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CachedUrl } from 'src/api/cached-url.ts';
import { ApiManager } from 'src/bot/api-manager.ts';
import type { Bot } from 'src/bot/bot.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';
import { GENERAL_CHANNEL_ID_CUTEDOG, type Guild } from 'src/discord/guild.ts';
import { newGuild } from 'src/discord/new-guild.ts';
import { User } from 'src/discord/user.ts';
import { messageCreateHandler } from 'src/handlers/messages/message-create.ts';
import { logError } from 'src/utils/log-error.ts';

const { handleMessage, handleCommand, handleComponent } = vi.hoisted(() => ({
  handleMessage: vi.fn(),
  handleCommand: vi.fn(),
  handleComponent: vi.fn()
}));

vi.mock('@discordjs/voice', () => ({ joinVoiceChannel: vi.fn() }));
vi.mock('src/handlers/commands/emote.ts', () => ({
  emotesHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/commands/settings.ts', () => ({
  settingsHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/discord/new-guild.ts', () => ({ newGuild: vi.fn() }));
vi.mock('src/utils/log-error.ts', () => ({ logError: vi.fn() }));
vi.mock('src/handlers/messages/message-create.ts', () => ({
  messageCreateHandler: vi.fn(() => handleMessage)
}));
vi.mock('src/bot/create-command-handlers.ts', () => ({
  createCommandHandlers: (): Map<string, typeof handleCommand> => new Map([['test', handleCommand]])
}));

vi.mock('src/handlers/interactions/button.ts', () => ({
  buttonHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/interactions/modal-submit.ts', () => ({
  modalSubmitHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/interactions/role-select-menu.ts', () => ({
  roleSelectMenuHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/interactions/autocomplete.ts', () => ({
  autocompleteHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/interactions/message-context-menu-command.ts', () => ({
  messageContextMenuCommandHandler: (): typeof handleComponent => handleComponent
}));

async function setup(
  guilds: readonly Readonly<Guild>[] = [],
  users: readonly Readonly<User>[] = [],
  voice = false
): Promise<{
  readonly client: Client;
  readonly ready: () => void;
  readonly guildDelete: (guild: Readonly<{ id: string }>) => void;
  readonly bot: Readonly<Bot>;
  readonly messageListener: (message: unknown) => void;
  readonly interactionListener: (interaction: unknown) => void;
}> {
  const { Bot } = await import('src/bot/bot.ts');
  const client = new Client({ intents: [] });
  Bot.createInstance(
    client,
    new ApiManager(undefined, undefined, {} as Readonly<CachedUrl>, undefined, undefined),
    { mediaDatabase: {} } as unknown as Readonly<DatabaseManager>,
    guilds,
    users
  );
  Bot.instance.registerListeners(voice);
  return {
    bot: Bot.instance,
    client,
    ready: client.listeners(Events.ClientReady)[0] as () => void,
    guildDelete: client.listeners(Events.GuildDelete)[0] as (
      guild: Readonly<{ id: string }>
    ) => void,
    messageListener: client.listeners(Events.MessageCreate)[0] as (message: unknown) => void,
    interactionListener: client.listeners(Events.InteractionCreate)[0] as (
      interaction: unknown
    ) => void
  };
}

function interaction(guildId: string | null): Readonly<Record<string, unknown>> {
  return {
    guildId,
    user: { id: 'user', bot: false },
    commandName: 'test',
    isChatInputCommand: (): boolean => true,
    isButton: (): boolean => false,
    isAutocomplete: (): boolean => false,
    isModalSubmit: (): boolean => false,
    isRoleSelectMenu: (): boolean => false,
    isMessageContextMenuCommand: (): boolean => false
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});

describe('Bot event handling', () => {
  test('shares guild initialization between concurrent message and interaction events', async () => {
    const { bot, messageListener, interactionListener } = await setup();
    const guild = { id: 'guild' } as unknown as Readonly<Guild>;
    const creation = Promise.withResolvers<Readonly<Guild>>();
    vi.mocked(newGuild).mockReturnValue(creation.promise);

    messageListener({ guildId: guild.id, author: { bot: false } });
    interactionListener(interaction(guild.id));
    expect(newGuild).toHaveBeenCalledOnce();
    creation.resolve(guild);
    await vi.waitFor(() => {
      expect(bot.guilds).toEqual([guild]);
      expect(messageCreateHandler).toHaveBeenCalledOnce();
      expect(handleMessage).toHaveBeenCalledOnce();
      expect(handleCommand).toHaveBeenCalledOnce();
    });
  });

  test('logs failed guild initialization and permits a later retry', async () => {
    const { bot, messageListener } = await setup();
    const guild = { id: 'retry' } as unknown as Readonly<Guild>;
    const error = new Error('initialization failed');
    vi.mocked(newGuild).mockRejectedValueOnce(error).mockResolvedValueOnce(guild);
    const message = { guildId: guild.id, author: { bot: false } };

    messageListener(message);
    await vi.waitFor(() => {
      expect(logError).toHaveBeenCalledWith(error, 'Error handling message');
    });
    expect(bot.guilds).toEqual([]);
    messageListener(message);
    await vi.waitFor(() => {
      expect(bot.guilds).toEqual([guild]);
    });
    expect(newGuild).toHaveBeenCalledTimes(2);
  });

  test('awaits and catches rejected command and message handlers', async () => {
    const { messageListener, interactionListener } = await setup();
    const guild = { id: 'handlers' } as unknown as Readonly<Guild>;
    vi.mocked(newGuild).mockResolvedValue(guild);
    const messageError = new Error('message failed');
    const commandError = new Error('command failed');
    handleMessage.mockRejectedValueOnce(messageError);
    handleCommand.mockRejectedValueOnce(commandError);

    messageListener({ guildId: guild.id, author: { bot: false } });
    interactionListener(interaction(guild.id));
    await vi.waitFor(() => {
      expect(logError).toHaveBeenCalledWith(messageError, 'Error handling message');
      expect(logError).toHaveBeenCalledWith(commandError, 'Error handling interaction');
    });
  });
});

test('bot-authored messages, direct messages and bot interactions do not initialize guilds', async () => {
  const { messageListener, interactionListener } = await setup();
  messageListener({ guildId: null, author: { bot: false } });
  messageListener({ guildId: 'guild', author: { bot: true } });
  interactionListener({ ...interaction('guild'), user: { id: 'robot', bot: true } });
  await Promise.resolve();
  expect(newGuild).not.toHaveBeenCalled();
  expect(handleMessage).not.toHaveBeenCalled();
  expect(handleCommand).not.toHaveBeenCalled();
});

test('unknown commands are ignored after reusing an initialized guild', async () => {
  const { interactionListener } = await setup();
  vi.mocked(newGuild).mockResolvedValue({ id: 'guild' } as Readonly<Guild>);
  interactionListener(interaction('guild'));
  await vi.waitFor(() => {
    expect(handleCommand).toHaveBeenCalledOnce();
  });
  interactionListener({ ...interaction('guild'), commandName: 'unknown' });
  await Promise.resolve();
  await Promise.resolve();
  expect(newGuild).toHaveBeenCalledOnce();
  expect(handleCommand).toHaveBeenCalledOnce();
});

test.each([
  'isButton',
  'isModalSubmit',
  'isRoleSelectMenu',
  'isAutocomplete',
  'isMessageContextMenuCommand'
])('dispatches %s interactions and awaits failures', async (kind) => {
  const { interactionListener } = await setup();
  vi.mocked(newGuild).mockResolvedValue({ id: 'guild' } as Readonly<Guild>);
  const error = new Error('component failed');
  handleComponent.mockRejectedValueOnce(error);
  const event = {
    ...interaction('guild'),
    isChatInputCommand: (): boolean => false,
    [kind]: (): boolean => true
  };
  interactionListener(event);
  await vi.waitFor(() => {
    expect(logError).toHaveBeenCalledWith(error, 'Error handling interaction');
  });
  expect(handleComponent).toHaveBeenCalledExactlyOnceWith(event);
  expect(handleCommand).not.toHaveBeenCalled();
});

test('an uninitialized Bot instance cannot be used', async () => {
  const { Bot } = await import('src/bot/bot.ts');
  expect(() => Bot.instance).toThrow('Bot instance not created.');
});

test.each([SLASH_COMMAND_NAMES.settings, SLASH_COMMAND_NAMES.emote, SLASH_COMMAND_NAMES.emotes])(
  'special commands dispatch through their dedicated handlers: %s',
  async (commandName) => {
    const guild = { id: 'guild' } as Readonly<Guild>;
    const { interactionListener } = await setup([guild]);
    interactionListener({ ...interaction('guild'), commandName });
    await vi.waitFor(() => {
      expect(handleComponent).toHaveBeenCalledOnce();
    });
    expect(newGuild).not.toHaveBeenCalled();
    expect(handleCommand).not.toHaveBeenCalled();
  }
);

test.each(['none', 'assigned', 'missing'])(
  'direct messages resolve assigned guilds: %s',
  async (assignment) => {
    const guild = { id: 'guild' } as Readonly<Guild>;
    const user = { id: 'user', guild, guildId: guild.id } as User;
    const { interactionListener } = await setup(
      assignment === 'assigned' ? [guild] : [],
      assignment === 'none' ? [] : [user]
    );
    interactionListener(interaction(null));
    if (assignment === 'assigned')
      await vi.waitFor(() => {
        expect(handleCommand).toHaveBeenCalledOnce();
      });
    else {
      await Promise.resolve();
      await Promise.resolve();
      expect(handleCommand).not.toHaveBeenCalled();
    }
  }
);

test.each([false, true])(
  'ready events set presence and optionally join voice: %s',
  async (voice) => {
    const target = await setup([], [], voice);
    target.client.user = {
      tag: 'Test bot',
      setStatus: vi.fn(),
      setPresence: vi.fn()
    } as unknown as ClientUser;
    target.client.channels.cache.set(GENERAL_CHANNEL_ID_CUTEDOG, {
      id: GENERAL_CHANNEL_ID_CUTEDOG,
      isVoiceBased: (): boolean => true,
      joinable: true,
      guild: { id: 'guild', voiceAdapterCreator: vi.fn() }
    } as unknown as VoiceChannel);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      target.ready();
      expect(vi.spyOn(target.client.user, 'setStatus')).toHaveBeenCalledWith('online');
      expect(joinVoiceChannel).toHaveBeenCalledTimes(voice ? 1 : 0);
      expect(target.bot.client).toBe(target.client);
      expect(target.bot.databaseManager).toBeDefined();
      expect(target.bot.apiManager).toBeDefined();
      expect(target.bot.scheduledJobs).toEqual([]);
    } finally {
      log.mockRestore();
    }
  }
);

test.each([false, true])(
  'departed guilds release subscriptions and user references even if disposal fails: %s',
  async (fails) => {
    const dispose = vi.fn();
    if (fails)
      dispose.mockImplementation(() => {
        throw new Error('dispose failed');
      });
    const guild = { id: 'guild', personalEmoteStore: { dispose } } as unknown as Readonly<Guild>;
    const user = new User('user', guild);
    const target = await setup([guild], [user]);
    target.guildDelete({ id: 'guild' });
    expect(dispose).toHaveBeenCalledOnce();
    expect(target.bot.guilds).toEqual([]);
    expect(user.guild).toBeUndefined();
    expect(user.guildId).toBe('guild');
    const restored = { id: 'guild' } as Readonly<Guild>;
    vi.mocked(newGuild).mockResolvedValue(restored);
    target.messageListener({ guildId: 'guild', author: { bot: false } });
    await vi.waitFor(() => {
      expect(user.guild).toBe(restored);
    });
  }
);

test('leaving while initialization is pending disposes the old result without cancelling a later rejoin', async () => {
  const target = await setup();
  const old = Promise.withResolvers<Readonly<Guild>>();
  const replacement = Promise.withResolvers<Readonly<Guild>>();
  vi.mocked(newGuild).mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
  const message = { guildId: 'guild', author: { bot: false } };
  target.messageListener(message);
  target.guildDelete({ id: 'guild' });
  target.messageListener(message);
  const dispose = vi.fn();
  old.resolve({ id: 'guild', personalEmoteStore: { dispose } } as unknown as Guild);
  await vi.waitFor(() => {
    expect(dispose).toHaveBeenCalledOnce();
  });
  target.messageListener(message);
  const guild = { id: 'guild' } as Guild;
  replacement.resolve(guild);
  await vi.waitFor(() => {
    expect(target.bot.guilds).toEqual([guild]);
  });
  expect(newGuild).toHaveBeenCalledTimes(2);
});

test('ready events discard saved guild state for servers the bot no longer belongs to', async () => {
  const dispose = vi.fn();
  const guild = { id: 'departed', personalEmoteStore: { dispose } } as unknown as Guild;
  const target = await setup([guild]);
  target.client.user = {
    tag: 'Test bot',
    setStatus: vi.fn(),
    setPresence: vi.fn()
  } as unknown as ClientUser;
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    target.ready();
    expect(target.bot.guilds).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});
