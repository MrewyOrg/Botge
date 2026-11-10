import { getVoiceConnection, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import {
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction
} from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ApiManager } from 'src/bot/api-manager.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager } from 'src/bot/message-builder-manager.ts';
import { Guild } from 'src/discord/guild.ts';
import { User } from 'src/discord/user.ts';
import { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import type { PersonalEmoteStore } from 'src/emotes/emote-store.ts';
import { twitchToAsset } from 'src/emotes/emote-to-asset.ts';
import {
  ADD_EMOTE_PERMITTED_ROLES_BUTTON_CUSTOM_ID,
  ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID,
  CONFIGURATION_GUILD_BUTTON_CUSTOM_ID,
  CONFIGURATION_USER_BUTTON_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID,
  SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID
} from 'src/handlers/commands/settings.ts';
import { buttonHandler } from 'src/handlers/interactions/button.ts';
import {
  ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
  ASSIGN_GUILD_MODAL_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID,
  SELECT_ADD_EMOTE_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID,
  SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID,
  VOICE_CHANNEL_SELECT_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID,
  VOICE_STATUS_EMOJI_CUSTOM_ID,
  VOICE_STATUS_ENABLED_CUSTOM_ID
} from 'src/handlers/interactions/component-ids.ts';
import { modalSubmitHandler } from 'src/handlers/interactions/modal-submit.ts';
import { roleSelectMenuHandler } from 'src/handlers/interactions/role-select-menu.ts';
import { canManageSettings } from 'src/handlers/interactions/settings-permissions.ts';
import {
  getCustomId,
  JUMP_TO_MODAL_BASE_CUSTOM_ID,
  JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID
} from 'src/message-builders/base.ts';
import {
  DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID,
  EmoteMessageBuilder
} from 'src/message-builders/emote-message-builder.ts';
import { MediaMessageBuilder } from 'src/message-builders/media-message-builder.ts';
import type { AssetInfo, MutableArray } from 'src/types.ts';

const providerSettings = vi.hoisted(() => ({
  use7TVGlobalEmotes: true,
  use7TVPersonalEmotes: true,
  use7TVAddedEmotes: true,
  useBTTVEmotes: true,
  useFFZEmotes: true,
  useTwitchEmotes: true
}));
vi.mock(import('@discordjs/voice'), async (importOriginal) => ({
  ...(await importOriginal()),
  getVoiceConnection: vi.fn(),
  joinVoiceChannel: vi.fn()
}));
vi.mock('src/config/botge-config.ts', () => ({ botgeConfig: { general: providerSettings } }));

vi.mock('src/handlers/interactions/settings-permissions.ts', () => ({
  canManageSettings: vi.fn()
}));

function makeGuild(emotes: readonly AssetInfo[] = []): Guild {
  return new Guild(
    'guild',
    null,
    undefined,
    new EmoteCatalog(() => [emotes]),
    {
      personalEmoteSets: { sevenTv: null, bttv: null, ffz: null },
      removeSevenTVEmoteNotInSet: vi.fn()
    } as unknown as Readonly<PersonalEmoteStore>,
    null,
    null,
    false
  );
}

type Mock = ReturnType<typeof vi.fn>;
type TestInteraction = {
  readonly customId: string;
  readonly user: Readonly<{ id: string }>;
  readonly guildId: string;
  readonly guild: Readonly<{ id: string }>;
  readonly member: Readonly<Record<string, never>>;
  readonly values: readonly string[];
  readonly fields: Readonly<{ getTextInputValue: Mock; getCheckbox: Mock }>;
  readonly deferReply: Mock;
  readonly deferUpdate: Mock;
  readonly editReply: Mock;
  readonly reply: Mock;
  readonly showModal: Mock;
};

function makeInteraction(customId: string, text = '', checkbox = false): TestInteraction {
  return {
    customId,
    user: { id: 'owner' },
    guildId: 'guild',
    guild: { id: 'guild' },
    member: {},
    values: ['role'],
    fields: {
      getTextInputValue: vi.fn().mockReturnValue(text),
      getCheckbox: vi.fn().mockReturnValue(checkbox)
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined)
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(canManageSettings).mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([
  ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID,
  CONFIGURATION_GUILD_BUTTON_CUSTOM_ID,
  VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID
])('stale settings buttons cannot change settings: %s', async (customId) => {
  const guild = makeGuild();
  const write = vi.fn();
  const interaction = makeInteraction(customId);
  vi.mocked(canManageSettings).mockResolvedValue(false);
  await buttonHandler({} as Client, guild, undefined, new MessageBuilderManager(), {
    permittedRoleIdsDatabase: { changeAllowEveryoneToAddEmote: write }
  } as unknown as Readonly<DatabaseManager>)(interaction as unknown as ButtonInteraction);
  expect(write).not.toHaveBeenCalled();
  expect(guild.allowEveryoneToAddEmote).toBe(false);
  expect(interaction.reply).toHaveBeenCalledWith({
    content: 'You do not have permission to change these settings.',
    flags: MessageFlags.Ephemeral
  });
  expect(interaction.showModal).not.toHaveBeenCalled();
});

test.each([false, true])(
  'settings are persisted before changing live permissions, write fails: %s',
  async (fails) => {
    const guild = makeGuild();
    const write =
      fails ?
        vi.fn().mockImplementation(() => {
          throw new Error('Storage unavailable');
        })
      : vi.fn();
    const interaction = makeInteraction(ALLOW_EVERYONE_TO_ADD_EMOTE_BUTTON_CUSTOM_ID);
    await buttonHandler({} as Client, guild, undefined, new MessageBuilderManager(), {
      permittedRoleIdsDatabase: { changeAllowEveryoneToAddEmote: write }
    } as unknown as Readonly<DatabaseManager>)(interaction as unknown as ButtonInteraction);
    expect(write).toHaveBeenCalledWith('guild', true);
    expect(guild.allowEveryoneToAddEmote).toBe(!fails);
  }
);

test('an empty added-emote list returns a useful response', async () => {
  const { ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID } =
    await import('src/handlers/commands/settings.ts');
  const interaction = makeInteraction(ADDED_EMOTE_DELETION_MENU_BUTTON_CUSTOM_ID);
  await buttonHandler(
    {} as Client,
    makeGuild(),
    undefined,
    new MessageBuilderManager(),
    {} as Readonly<DatabaseManager>
  )(interaction as unknown as ButtonInteraction);
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No emotes'));
});

test.each([
  SELECT_ADD_EMOTE_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID,
  SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID
])(
  'role selection rechecks permissions and persists only authorized selections: %s',
  async (customId) => {
    const guild = makeGuild();
    const writeAdd = vi.fn();
    const writeSettings = vi.fn();
    const database = {
      permittedRoleIdsDatabase: {
        changeAddEmotePermittedRoleIds: writeAdd,
        changeSettingsPermittedRoleIds: writeSettings
      }
    } as unknown as Readonly<DatabaseManager>;
    const interaction = makeInteraction(customId);
    vi.mocked(canManageSettings).mockResolvedValueOnce(false);
    await roleSelectMenuHandler(
      guild,
      database
    )(interaction as unknown as RoleSelectMenuInteraction);
    expect(writeAdd).not.toHaveBeenCalled();
    expect(writeSettings).not.toHaveBeenCalled();
    await roleSelectMenuHandler(
      guild,
      database
    )(interaction as unknown as RoleSelectMenuInteraction);
    const write =
      customId === SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID ? writeSettings : (
        writeAdd
      );
    expect(write).toHaveBeenCalledWith('guild', ['role']);
    expect(
      customId === SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID ?
        guild.settingsPermittedRoleIds
      : guild.addEmotePermittedRoleIds
    ).toEqual(['role']);
  }
);

test('failed role persistence leaves live settings unchanged', async () => {
  const guild = makeGuild();
  const interaction = makeInteraction(SELECT_SETTINGS_PERMITTED_ROLES_ROLE_SELECT_MENU_CUSTOM_ID);
  const database = {
    permittedRoleIdsDatabase: {
      changeSettingsPermittedRoleIds: (): never => {
        throw new Error('Storage unavailable');
      }
    }
  } as unknown as Readonly<DatabaseManager>;
  await roleSelectMenuHandler(guild, database)(interaction as unknown as RoleSelectMenuInteraction);
  expect(guild.settingsPermittedRoleIds).toBeNull();
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Failed'));
});

test.each(['missing', 'guild'])(
  'guild assignment validates the target and creates a user only after saving: %s',
  async (target) => {
    const guild = makeGuild();
    const users: MutableArray<Readonly<User>> = [];
    const write = vi.fn();
    const interaction = makeInteraction(ASSIGN_GUILD_MODAL_CUSTOM_ID, target);
    await modalSubmitHandler(
      [guild],
      users,
      guild,
      new MessageBuilderManager(),
      { usersDatabase: { changeGuildId: write } } as unknown as Readonly<DatabaseManager>,
      {} as Readonly<ApiManager>
    )(interaction as unknown as ModalSubmitInteraction);
    if (target === 'missing') {
      expect(write).not.toHaveBeenCalled();
      expect(users).toEqual([]);
    } else {
      expect(write).toHaveBeenCalledWith('owner', 'guild');
      expect(users.map((user) => user.guild?.id)).toEqual(['guild']);
    }
  }
);

test('failed guild assignment does not create a live user', async () => {
  const guild = makeGuild();
  const users: MutableArray<Readonly<User>> = [];
  const interaction = makeInteraction(ASSIGN_GUILD_MODAL_CUSTOM_ID, 'guild');
  const database = {
    usersDatabase: {
      changeGuildId: (): never => {
        throw new Error('Storage unavailable');
      }
    }
  } as unknown as Readonly<DatabaseManager>;
  await modalSubmitHandler(
    [guild],
    users,
    guild,
    new MessageBuilderManager(),
    database,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);
  expect(users).toEqual([]);
});

test('emote-set modals require current owner permissions before any lookup', async () => {
  const guild = makeGuild();
  const interaction = makeInteraction(
    ASSIGN_EMOTE_SETS_MODAL_CUSTOM_ID,
    'https://7tv.app/emote-sets/id'
  );
  vi.mocked(canManageSettings).mockResolvedValue(false);
  await modalSubmitHandler(
    [guild],
    [],
    guild,
    new MessageBuilderManager(),
    {} as Readonly<DatabaseManager>,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);
  expect(canManageSettings).toHaveBeenCalledWith(interaction, guild, true);
  expect(fetch).not.toHaveBeenCalled();
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('permission'));
});

test('invalid border colors cannot reach storage', async () => {
  const guild = makeGuild();
  const write = vi.fn();
  const interaction = makeInteraction(EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID, 'invalid', true);
  await modalSubmitHandler(
    [guild],
    [],
    guild,
    new MessageBuilderManager(),
    { usersDatabase: { changeEnableEmoteBorder: write } } as unknown as Readonly<DatabaseManager>,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);
  expect(write).not.toHaveBeenCalled();
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('RR'));
});

test('border persistence failures leave the live user unchanged', async () => {
  const guild = makeGuild();
  const user = new User('owner', undefined, false, '000000');
  const interaction = makeInteraction(EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID, '', true);
  const database = {
    usersDatabase: {
      changeEnableEmoteBorder: (): never => {
        throw new Error('Storage unavailable');
      }
    }
  } as unknown as Readonly<DatabaseManager>;
  await modalSubmitHandler(
    [guild],
    [user],
    guild,
    new MessageBuilderManager(),
    database,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);
  expect(user.enableEmoteBorder).toBe(false);
});

test('a navigation modal cannot edit another user’s response', async () => {
  const guild = makeGuild();
  const original = { user: { id: 'someone-else' }, editReply: vi.fn() };
  const builder = new MediaMessageBuilder(
    original as unknown as ChatInputCommandInteraction,
    [{ name: 'one', url: 'https://example.com/one.gif', dateAdded: new Date(0) }],
    undefined
  );
  const manager = new MessageBuilderManager();
  manager.mediaMessageBuilders.push(builder);
  const interaction = makeInteraction(
    getCustomId(
      JUMP_TO_MODAL_BASE_CUSTOM_ID,
      MediaMessageBuilder.messageBuilderType,
      builder.counter
    ),
    '1'
  );
  const pageId = getCustomId(
    JUMP_TO_TEXT_INPUT_BASE_CUSTOM_ID,
    MediaMessageBuilder.messageBuilderType,
    builder.counter
  );
  interaction.fields.getTextInputValue.mockImplementation((id: string): string => {
    if (id === pageId) return '1';
    throw new Error('Optional field is absent.');
  });
  await modalSubmitHandler(
    [guild],
    [],
    guild,
    manager,
    {} as Readonly<DatabaseManager>,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);
  expect(original.editReply).not.toHaveBeenCalled();
  expect(interaction.reply).toHaveBeenCalledWith({
    content: 'You can only navigate your own response.',
    flags: MessageFlags.Ephemeral
  });
});

test.each([
  CONFIGURATION_USER_BUTTON_CUSTOM_ID,
  CONFIGURATION_GUILD_BUTTON_CUSTOM_ID,
  EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID
])('configuration buttons show editable modals: %s', async (customId) => {
  const guild = makeGuild();
  const user = new User('owner', guild, true, '123456');
  const interaction = makeInteraction(customId);
  await buttonHandler(
    {} as Client,
    guild,
    user,
    new MessageBuilderManager(),
    {} as DatabaseManager
  )(interaction as unknown as ButtonInteraction);
  expect(interaction.showModal).toHaveBeenCalledOnce();
});

test.each([SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID, ADD_EMOTE_PERMITTED_ROLES_BUTTON_CUSTOM_ID])(
  'role configuration buttons offer a selection menu: %s',
  async (customId) => {
    const guild = makeGuild();
    guild.changeSettingsPermittedRoleIds(['123456789012345678']);
    guild.changeAddEmotePermittedRoleIds(['123456789012345678']);
    const interaction = makeInteraction(customId);
    await buttonHandler(
      {} as Client,
      guild,
      undefined,
      new MessageBuilderManager(),
      {} as DatabaseManager
    )(interaction as unknown as ButtonInteraction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          customId === SETTINGS_PERMITTED_ROLES_BUTTON_CUSTOM_ID ?
            'Choose roles that can use /settings. Clear the selection to remove role-based access.'
          : 'Choose roles that can use /emote-add. Clear the selection to remove role-based access.'
      })
    );
  }
);

test.each([true, false])(
  'valid emote border settings update persistence and current user: %s',
  async (existing) => {
    const guild = makeGuild();
    const users: Readonly<User>[] = existing ? [new User('owner', guild, false, '000000')] : [];
    const interaction = makeInteraction(EMOTE_BORDER_CONFIGURATION_MODAL_CUSTOM_ID, '123456', true);
    const writeEnabled = vi.fn();
    const writeColor = vi.fn();
    await modalSubmitHandler(
      [guild],
      users,
      guild,
      new MessageBuilderManager(),
      {
        usersDatabase: { changeEnableEmoteBorder: writeEnabled, changeEmoteBorderColor: writeColor }
      } as unknown as DatabaseManager,
      {} as ApiManager
    )(interaction as unknown as ModalSubmitInteraction);
    expect(writeEnabled).toHaveBeenCalledWith('owner', true);
    expect(writeColor).toHaveBeenCalledWith('owner', '123456');
    expect(users[0]?.enableEmoteBorder).toBe(true);
    expect(users[0]?.emoteBorderColor).toBe('123456');
  }
);

test('added-emote deletion menus return a builder whose delete action updates storage and the catalog', async () => {
  const asset = {
    ...twitchToAsset({ id: 'id', name: 'Added', format: ['static'], theme_mode: ['dark'] }),
    platform: 'sevenNotInSet' as const
  };
  const guild = makeGuild([asset]);
  const manager = new MessageBuilderManager();
  const remove = vi.fn();
  const database = { addedEmotesDatabase: { delete: remove } } as unknown as DatabaseManager;
  const menu = makeInteraction('addedEmoteDeletionMenuButton');
  const builder = await buttonHandler(
    {} as Client,
    guild,
    undefined,
    manager,
    database
  )(menu as unknown as ButtonInteraction);
  if (builder === undefined) throw new Error('Expected deletion menu.');
  manager.emoteMessageBuilders.push(builder);
  const event = makeInteraction(
    getCustomId(
      DELETE_EMOTE_BUTTON_BASE_CUSTOM_ID,
      EmoteMessageBuilder.messageBuilderType,
      builder.counter
    )
  );
  await buttonHandler(
    {} as Client,
    guild,
    undefined,
    manager,
    database
  )(event as unknown as ButtonInteraction);
  expect(remove).toHaveBeenCalledWith(
    { url: 'https://7tv.io/v3/emotes/id', alias: 'Added' },
    'guild'
  );
  expect(builder.currentAddedEmote).toBeUndefined();
  await buttonHandler(
    {} as Client,
    guild,
    undefined,
    manager,
    database
  )(event as unknown as ButtonInteraction);
  expect(remove).toHaveBeenCalledOnce();
});

test('guild configuration prefills the current broadcaster and set', async () => {
  const guild = makeGuild();
  vi.spyOn(guild, 'broadcasterName', 'get').mockReturnValue('Streamer');
  vi.spyOn(guild, 'personalEmoteStore', 'get').mockReturnValue({
    personalEmoteSets: { sevenTv: 'https://7tv.io/v3/emote-sets/set', bttv: null, ffz: null }
  } as Readonly<PersonalEmoteStore>);
  const interaction = makeInteraction(CONFIGURATION_GUILD_BUTTON_CUSTOM_ID);
  await buttonHandler(
    {} as Client,
    guild,
    undefined,
    new MessageBuilderManager(),
    {} as DatabaseManager
  )(interaction as unknown as ButtonInteraction);
  expect(interaction.showModal).toHaveBeenCalledOnce();
});

test.each([CONFIGURATION_USER_BUTTON_CUSTOM_ID, EMOTE_BORDER_CONFIGURATION_BUTTON_CUSTOM_ID])(
  'configuration modals support users without saved preferences: %s',
  async (id) => {
    const interaction = makeInteraction(id);
    await buttonHandler(
      {} as Client,
      makeGuild(),
      undefined,
      new MessageBuilderManager(),
      {} as DatabaseManager
    )(interaction as unknown as ButtonInteraction);
    expect(interaction.showModal).toHaveBeenCalledOnce();
  }
);

test.each([false, true])(
  'voice settings open a clearable voice-only picker, saved channel exists: %s',
  async (exists) => {
    const channelId = '123456789012345678';
    const emoji = '<:test_emoji:123456789012345678>';
    const base = makeInteraction(VOICE_CHANNEL_SETTINGS_BUTTON_CUSTOM_ID);
    const interaction = {
      ...base,
      guild: {
        ...base.guild,
        channels: { cache: new Map(exists ? [[channelId, { type: ChannelType.GuildVoice }]] : []) }
      }
    };
    const database = {
      databases: {
        voiceChannelsDatabase: {
          getChannelId: vi.fn().mockReturnValue(channelId),
          getStatusSettings: vi
            .fn()
            .mockReturnValue({ enabled: exists, emoji: exists ? emoji : null })
        }
      }
    } as unknown as Readonly<DatabaseManager>;

    await buttonHandler(
      {} as Client,
      makeGuild(),
      undefined,
      new MessageBuilderManager(),
      database
    )(interaction as unknown as ButtonInteraction);

    const modal: unknown = interaction.showModal.mock.calls[0]?.[0];
    if (!(modal instanceof ModalBuilder)) throw new Error('Expected a voice channel modal.');
    const payload = modal.toJSON();
    expect(payload).toMatchObject({
      custom_id: VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID,
      components: [
        {
          component: {
            custom_id: VOICE_CHANNEL_SELECT_CUSTOM_ID,
            channel_types: [ChannelType.GuildVoice],
            min_values: 0,
            max_values: 1,
            required: false
          }
        },
        { component: { custom_id: VOICE_STATUS_ENABLED_CUSTOM_ID, default: exists } },
        { component: { custom_id: VOICE_STATUS_EMOJI_CUSTOM_ID, required: false } }
      ]
    });
    if (exists) {
      expect(payload).toHaveProperty('components.2.component.value', emoji);
      expect(payload).toHaveProperty('components.0.component.default_values', [
        { id: channelId, type: 'channel' }
      ]);
    } else {
      expect(payload).not.toHaveProperty('components.0.component.default_values');
    }
  }
);

test.each([
  'join',
  'switch',
  'clear',
  'denied',
  'unavailable',
  'missing',
  'wrong type',
  'gateway failure',
  'storage failure',
  'enable status',
  'disable status',
  'status request failure',
  'invalid emoji',
  'missing emoji'
])('voice settings validate and apply the selection: %s', async (scenario) => {
  const guild = makeGuild();
  const saveSettings = vi.fn();
  const emoji = '<:test_emoji:123456789012345678>';
  const enableStatus = scenario === 'enable status' || scenario === 'status request failure';
  const alreadyJoined = enableStatus || scenario === 'disable status';
  const put = vi.fn().mockResolvedValue(undefined);
  if (scenario === 'status request failure') put.mockRejectedValue(new Error('Missing permission'));
  const destroy = vi.fn();
  const on = vi.fn();
  const rejoin = vi.fn<() => boolean>().mockReturnValue(true);
  const voiceAdapterCreator = vi.fn();
  const database = {
    databases: { voiceChannelsDatabase: { saveSettings } }
  } as unknown as Readonly<DatabaseManager>;
  const connection = {
    destroy,
    on,
    rejoin,
    state: {
      status:
        scenario === 'gateway failure' ?
          VoiceConnectionStatus.Disconnected
        : VoiceConnectionStatus.Signalling
    }
  } as unknown as ReturnType<typeof joinVoiceChannel>;
  vi.mocked(joinVoiceChannel).mockReturnValue(connection);
  if (scenario === 'clear' || scenario === 'switch')
    vi.mocked(getVoiceConnection).mockReturnValue(connection);
  vi.mocked(canManageSettings).mockResolvedValue(scenario !== 'denied');
  if (scenario === 'storage failure')
    saveSettings.mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });

  const base = makeInteraction(VOICE_CHANNEL_SETTINGS_MODAL_CUSTOM_ID);
  const interactionGuild = {
    ...base.guild,
    voiceAdapterCreator,
    members: { me: { voice: { channelId: alreadyJoined ? 'voice' : null } } },
    channels: { cache: new Map() }
  };
  if (scenario !== 'missing') {
    interactionGuild.channels.cache.set('voice', {
      id: 'voice',
      type: scenario === 'wrong type' ? ChannelType.GuildText : ChannelType.GuildVoice,
      joinable: scenario !== 'unavailable',
      guild: interactionGuild
    });
  }
  const interaction = {
    ...base,
    guild: interactionGuild,
    client: { rest: { put } },
    fields: {
      getCheckbox: vi.fn().mockReturnValue(enableStatus || scenario === 'missing emoji'),
      getTextInputValue: vi.fn().mockReturnValue(
        scenario === 'invalid emoji' ? ':emoji:'
        : scenario === 'missing emoji' ? ''
        : emoji
      ),
      getField: vi
        .fn()
        .mockReturnValue({
          type: ComponentType.ChannelSelect,
          values: scenario === 'clear' ? [] : ['voice']
        })
    }
  };

  await modalSubmitHandler(
    [guild],
    [],
    guild,
    new MessageBuilderManager(),
    database,
    {} as Readonly<ApiManager>
  )(interaction as unknown as ModalSubmitInteraction);

  if (scenario === 'clear') {
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith('guild', undefined, {
      enabled: false,
      emoji
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  } else {
    expect(destroy).not.toHaveBeenCalled();
  }
  if (scenario === 'join' || scenario === 'switch' || scenario === 'gateway failure') {
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith('guild', 'voice', {
      enabled: false,
      emoji
    });
    const voiceSettings = { channelId: 'voice', selfDeaf: false, selfMute: true };
    if (scenario === 'switch') {
      expect(rejoin).toHaveBeenCalledExactlyOnceWith(voiceSettings);
      expect(joinVoiceChannel).not.toHaveBeenCalled();
      expect(on).not.toHaveBeenCalled();
    } else {
      expect(joinVoiceChannel).toHaveBeenCalledExactlyOnceWith({
        ...voiceSettings,
        guildId: 'guild',
        adapterCreator: voiceAdapterCreator
      });
      expect(on).toHaveBeenCalledOnce();
    }
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining(
        scenario === 'gateway failure' ? 'try again on startup' : 'Saved <#voice>'
      )
    );
  } else {
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    if (alreadyJoined)
      expect(saveSettings).toHaveBeenCalledExactlyOnceWith('guild', 'voice', {
        enabled: enableStatus,
        emoji
      });
    else
      expect(saveSettings).toHaveBeenCalledTimes(
        scenario === 'clear' || scenario === 'storage failure' ? 1 : 0
      );
  }
  if (enableStatus) {
    expect(put).toHaveBeenCalledExactlyOnceWith('/channels/voice/voice-status', {
      body: { status: emoji }
    });
  } else {
    expect(put).not.toHaveBeenCalled();
  }
});
