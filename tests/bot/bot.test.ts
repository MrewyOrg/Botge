import { joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import {
  ChannelType,
  Client,
  type ClientUser,
  type Guild as DiscordGuild,
  Events
} from 'discord.js';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CachedUrl } from 'src/api/cached-url.ts';
import { ApiManager } from 'src/bot/api-manager.ts';
import type { Bot } from 'src/bot/bot.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';
import type { Guild } from 'src/discord/guild.ts';
import { newGuild } from 'src/discord/new-guild.ts';
import { User } from 'src/discord/user.ts';
import { addSevenTVEmote, canAddEmote } from 'src/emotes/add-emote.ts';
import { messageCreateHandler } from 'src/handlers/messages/message-create.ts';
import { logError } from 'src/utils/log-error.ts';

const { handleMessage, handleCommand, handleComponent } = vi.hoisted(() => ({
  handleMessage: vi.fn(),
  handleCommand: vi.fn(),
  handleComponent: vi.fn()
}));

vi.mock(import('@discordjs/voice'), async (importOriginal) => ({
  ...(await importOriginal()),
  joinVoiceChannel: vi.fn()
}));
vi.mock('src/handlers/commands/emote.ts', () => ({
  emotesHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/handlers/commands/settings.ts', () => ({
  settingsHandler: (): typeof handleComponent => handleComponent
}));
vi.mock('src/emotes/add-emote.ts', () => ({ addSevenTVEmote: vi.fn(), canAddEmote: vi.fn() }));
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
  voiceChannelIds: Readonly<Record<string, string>> = {},
  voiceStatus = { enabled: false, emoji: null } as Readonly<{
    enabled: boolean;
    emoji: string | null;
  }>
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
    {
      mediaDatabase: {},
      addedEmotesDatabase: {},
      databases: {
        voiceChannelsDatabase: {
          getChannelId: (id: string) => voiceChannelIds[id],
          getStatusSettings: () => voiceStatus
        }
      }
    } as unknown as Readonly<DatabaseManager>,
    guilds,
    users
  );
  Bot.instance.registerListeners();
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

test('ready restores saved voice channels independently and skips unusable targets', async () => {
  const saved = new Map([
    ['failed', 'voice-1'],
    ['missing', 'voice-2'],
    ['blocked', 'voice-3'],
    ['text', 'text-4'],
    ['allowed', 'voice-5']
  ]);
  const target = await setup([], [], Object.fromEntries(saved));
  target.client.user = { tag: 'Test bot' } as unknown as ClientUser;
  const adapterCreator = vi.fn();
  for (const id of [...saved.keys(), 'no-selection']) {
    const guild = { id, voiceAdapterCreator: adapterCreator, channels: { cache: new Map() } };
    if (id !== 'missing') {
      guild.channels.cache.set(saved.get(id), {
        guild,
        id: saved.get(id),
        type: id === 'text' ? ChannelType.GuildText : ChannelType.GuildVoice,
        joinable: id !== 'blocked'
      });
    }
    target.client.guilds.cache.set(id, guild as unknown as DiscordGuild);
  }
  const on = vi.fn();
  const connection = {
    on,
    state: { status: VoiceConnectionStatus.Signalling }
  } as unknown as ReturnType<typeof joinVoiceChannel>;
  const error = new Error('voice unavailable');
  vi.mocked(joinVoiceChannel)
    .mockImplementationOnce(() => {
      throw error;
    })
    .mockReturnValue(connection);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    target.ready();
    expect(logError).toHaveBeenCalledWith(error, 'Error restoring voice channel for guild failed');
    expect(joinVoiceChannel).toHaveBeenCalledTimes(2);
    expect(joinVoiceChannel).toHaveBeenLastCalledWith({
      channelId: 'voice-5',
      guildId: 'allowed',
      adapterCreator,
      selfDeaf: false,
      selfMute: true
    });
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    const errorListener = on.mock.calls[0]?.[1] as (error: Readonly<Error>) => void;
    errorListener(error);
    expect(logError).toHaveBeenCalledWith(error, 'Voice connection failed for guild allowed');
    expect(target.bot.client).toBe(target.client);
    expect(target.bot.databaseManager).toBeDefined();
    expect(target.bot.apiManager).toBeDefined();
    expect(target.bot.scheduledJobs).toEqual([]);
  } finally {
    log.mockRestore();
  }
});

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
  target.client.user = { tag: 'Test bot' } as unknown as ClientUser;
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    target.ready();
    expect(target.bot.guilds).toEqual([]);
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    log.mockRestore();
  }
});

test.each([
  {
    name: 'joining the selected channel',
    userId: 'bot',
    previousChannelId: null,
    channelId: 'voice',
    update: true
  },
  {
    name: 'switching to the selected channel',
    userId: 'bot',
    previousChannelId: 'other',
    channelId: 'voice',
    update: true
  },
  {
    name: 'status disabled',
    userId: 'bot',
    previousChannelId: null,
    channelId: 'voice',
    update: false
  },
  {
    name: 'another user joining',
    userId: 'user',
    previousChannelId: null,
    channelId: 'voice',
    update: false
  },
  {
    name: 'joining a different channel',
    userId: 'bot',
    previousChannelId: null,
    channelId: 'other',
    update: false
  },
  {
    name: 'leaving voice',
    userId: 'bot',
    previousChannelId: 'voice',
    channelId: null,
    update: false
  },
  {
    name: 'changing mute state',
    userId: 'bot',
    previousChannelId: 'voice',
    channelId: 'voice',
    update: false
  }
] as const)(
  'updates the voice status only on Botge joining its configured channel: $name',
  async ({ name, userId, previousChannelId, channelId, update }) => {
    const emoji = '<:test_emoji:123456789012345678>';
    const { client } = await setup(
      [],
      [],
      { guild: 'voice' },
      { enabled: name !== 'status disabled', emoji }
    );
    client.user = { id: 'bot' } as ClientUser;
    const error = new Error('Missing voice status permission');
    const put = vi.spyOn(client.rest, 'put').mockRejectedValue(error);
    const listener = client.listeners(Events.VoiceStateUpdate)[0] as (
      before: unknown,
      after: unknown
    ) => void;

    listener({ channelId: previousChannelId }, { channelId, id: userId, guild: { id: 'guild' } });

    if (update) {
      expect(put).toHaveBeenCalledExactlyOnceWith('/channels/voice/voice-status', {
        body: { status: emoji }
      });
      await vi.waitFor(() => {
        expect(logError).toHaveBeenCalledWith(
          error,
          'Error setting voice channel status for guild guild'
        );
      });
    } else {
      expect(put).not.toHaveBeenCalled();
    }
  }
);

test.each(['missing server', 'missing member', 'denied', 'allowed'])(
  'Activity adds verify current server access before writing: %s',
  async (scenario) => {
    const guild = { id: 'guild' } as Readonly<Guild>;
    const { bot, client } = await setup([guild]);
    const member = { user: { id: 'user' }, roles: { cache: new Map() } };
    const fetch = vi.fn().mockResolvedValue(member);
    if (scenario === 'missing member') fetch.mockRejectedValue(new Error('Unknown member'));
    const discordGuild = { id: guild.id, members: { fetch } } as unknown as DiscordGuild;
    if (scenario !== 'missing server') client.guilds.cache.set(guild.id, discordGuild);
    vi.mocked(canAddEmote).mockReturnValue(scenario === 'allowed');
    vi.mocked(addSevenTVEmote).mockResolvedValue({ status: 201, message: 'Added' });

    const result = await bot.activityEmotes(guild.id, 'user', 'emote');

    if (scenario === 'missing server') expect(fetch).not.toHaveBeenCalled();
    else expect(fetch).toHaveBeenCalledExactlyOnceWith({ user: 'user', force: true });
    if (scenario === 'allowed') {
      expect(canAddEmote).toHaveBeenCalledExactlyOnceWith(guild, discordGuild, member, []);
      expect(addSevenTVEmote).toHaveBeenCalledExactlyOnceWith(
        bot.databaseManager.addedEmotesDatabase,
        guild,
        'https://7tv.app/emotes/emote',
        null
      );
      expect(result.status).toBe(201);
    } else {
      expect(addSevenTVEmote).not.toHaveBeenCalled();
      expect(result.status).toBe(scenario === 'missing server' ? 404 : 403);
    }
  }
);

test('Activity catalog returns the selected server’s enabled emotes after verifying membership', async () => {
  const assets = [
    {
      name: 'Wave',
      url: 'https://cdn.7tv.app/emote/id/2x.webp',
      animated: true,
      zeroWidth: true,
      platform: 'sevenNotInSet'
    },
    {
      name: 'Static',
      url: 'https://cdn.betterttv.net/emote/id/2x.png',
      animated: false,
      zeroWidth: false
    },
    {
      name: 'Wave',
      url: 'https://cdn.betterttv.net/emote/duplicate/2x.png',
      animated: false,
      zeroWidth: false
    },
    { name: 'Unsafe', url: 'https://example.com/image.png', animated: false },
    { name: 'Credentials', url: 'https://name@cdn.7tv.app/image.png', animated: false },
    { name: 'Invalid', url: 'invalid', animated: false }
  ];
  const matchSingleArray = vi.fn().mockReturnValue(assets);
  const guild = { id: 'guild', emoteCatalog: { matchSingleArray } } as unknown as Guild;
  const { bot, client } = await setup([guild]);
  const fetch = vi.fn().mockResolvedValue({ user: { id: 'user' } });
  client.guilds.cache.set(guild.id, {
    id: guild.id,
    members: { fetch }
  } as unknown as DiscordGuild);

  expect(await bot.activityEmotes(guild.id, 'user', undefined)).toEqual({
    status: 200,
    message: 'Server emotes loaded.',
    emotes: [
      {
        name: 'Wave',
        source: '7TV',
        image: '/7tv-cdn/emote/id/2x.webp',
        animated: true,
        added: true,
        zeroWidth: true,
        composeToken: 'Wave'
      },
      {
        name: 'Static',
        source: 'BTTV',
        image: '/bttv-cdn/emote/id/2x.png',
        animated: false,
        added: false,
        zeroWidth: false,
        composeToken: 'Static'
      },
      {
        name: 'Wave',
        source: 'BTTV',
        image: '/bttv-cdn/emote/duplicate/2x.png',
        animated: false,
        added: false,
        zeroWidth: false
      }
    ]
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith({ user: 'user', force: true });
  expect(canAddEmote).not.toHaveBeenCalled();
  expect(addSevenTVEmote).not.toHaveBeenCalled();
});
