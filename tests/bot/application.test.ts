import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => {
  const guild = {
    id: 'guild',
    refreshClips: vi.fn(),
    refreshUniqueCreatorNamesAndGameIds: vi.fn(),
    personalEmoteStore: { refreshBTTVAndFFZPersonalEmotes: vi.fn() }
  };
  const databases = {
    usersDatabase: { getAllUsers: vi.fn() },
    broadcasterNameAndPersonalEmoteSetsDatabase: {
      getAllBroadcasterNamesAndPersonalEmoteSets: vi.fn()
    },
    addedEmotesDatabase: {},
    pingsDatabase: {}
  };
  return {
    guild,
    databases,
    login: vi.fn(),
    close: vi.fn(),
    shutdown: vi.fn(),
    update: vi.fn(),
    register: vi.fn(),
    schedule: vi.fn<(name: string, cron: string, task: () => unknown) => void>(),
    prepare: vi.fn(),
    token: vi.fn(),
    cleanup: vi.fn(),
    globalRefresh: vi.fn(),
    listeners: vi.fn(),
    refreshToken: vi.fn(),
    createBot: vi.fn(),
    globalInit: vi.fn(),
    guildInit: vi.fn()
  };
});
vi.mock('src/config/botge-config.ts', () => ({
  botgeConfig: {
    general: {
      autoCompleteOnly7TVPersonal: true,
      use7TVGlobalEmotes: true,
      use7TVPersonalEmotes: true,
      use7TVAddedEmotes: true,
      useBTTVEmotes: true,
      useFFZEmotes: true,
      useTwitchEmotes: true,
      updateClipsOnStartup: true
    }
  }
}));
vi.mock('src/bot/create-discord-client.ts', () => ({
  createDiscordClient: vi.fn(() => ({ login: state.login }))
}));
vi.mock('deepl-node', () => ({
  DeepLClient: class {
    public readonly options: unknown;
    public constructor(options: unknown) {
      this.options = options;
    }
  }
}));
vi.mock('openai', () => ({
  default: class {
    public readonly options: unknown;
    public constructor(options: unknown) {
      this.options = options;
    }
  }
}));
vi.mock('meilisearch', () => ({
  Meilisearch: class {
    public readonly options: unknown;
    public constructor(options: unknown) {
      this.options = options;
    }
  }
}));
vi.mock('src/api/cached-url.ts', () => ({
  CachedUrl: class {
    public readonly options: unknown;
    public constructor(options: unknown) {
      this.options = options;
    }
  }
}));
vi.mock('src/api/twitch/new-twitch-api.ts', () => ({ newTwitchApi: state.token }));
vi.mock('src/api/twitch/twitch-clips-meilisearch.ts', () => ({
  TwitchClipsMeilisearch: class {
    public readonly options: unknown;
    public constructor(options: unknown) {
      this.options = options;
    }
  }
}));
vi.mock('src/bot/database-manager.ts', () => ({
  DatabaseManager: class {
    public readonly databases = state.databases;
    public readonly closeDatabases = state.close;
  }
}));
vi.mock('src/database/open-databases.ts', () => ({ openDatabases: vi.fn() }));
vi.mock('src/discord/new-guild.ts', () => ({ newGuild: state.guildInit }));
vi.mock('src/discord/update-commands.ts', () => ({ updateCommands: state.update }));
vi.mock('src/bot/register-pings.ts', () => ({ registerPings: state.register }));
vi.mock('src/bot/lifecycle.ts', () => ({
  createShutdown: vi.fn((_client: unknown, cleanup: () => void) => async (): Promise<void> => {
    cleanup();
    await state.shutdown();
  }),
  prepareDirectories: state.prepare,
  scheduleTask: state.schedule
}));
vi.mock('src/emotes/seventv/event-client.ts', () => ({ sevenTVEvents: { close: vi.fn() } }));
vi.mock('src/emotes/emote-store.ts', () => ({
  GlobalEmoteStore: {
    createInstance: state.globalInit,
    instance: { refreshGlobalEmotes: state.globalRefresh }
  }
}));
vi.mock('src/bot/bot.ts', () => ({
  Bot: {
    createInstance: state.createBot,
    instance: {
      registerListeners: state.listeners,
      guilds: [state.guild],
      scheduledJobs: [],
      messageBuilderManager: { cleanupMessageBuilders: state.cleanup }
    }
  }
}));
vi.mock('src/utils/log-error.ts', () => ({ logError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    'APP_ID',
    'DISCORD_TOKEN',
    'OPENAI_API_KEY',
    'DEEPL_API_KEY',
    'TWITCH_CLIENT_ID',
    'TWITCH_SECRET',
    'MEILISEARCH_HOST',
    'MEILI_MASTER_KEY',
    'LOCAL_CACHE_BASE'
  ])
    vi.stubEnv(name, 'test-value');
  vi.stubEnv('AUTOCOMPLETE_ONLY_7TV_PERSONAL', '');
  vi.spyOn(process, 'once').mockReturnValue(process);
  vi.spyOn(process, 'on').mockReturnValue(process);
  vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit intercepted');
  });
  state.guildInit.mockResolvedValue(state.guild);
  state.token.mockResolvedValue({ validateAndGetNewAccessTokenIfInvalid: state.refreshToken });
  state.databases.usersDatabase.getAllUsers.mockReturnValue([
    { userId: 'one', guildId: 'guild', enableEmoteBorder: 1, emoteBorderColor: 'ffffff' },
    { userId: 'two', guildId: null, enableEmoteBorder: null, emoteBorderColor: null }
  ]);
  state.databases.broadcasterNameAndPersonalEmoteSetsDatabase.getAllBroadcasterNamesAndPersonalEmoteSets.mockReturnValue(
    new Map([['guild', ['streamer', undefined]]])
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

test('startup restores settings, registers commands, logs in, and schedules maintenance', async () => {
  const { startApplication } = await import('src/application.ts');
  await startApplication();
  expect(state.update).toHaveBeenCalledWith(
    'data/commands.txt',
    undefined,
    undefined,
    'test-value',
    'test-value'
  );
  expect(state.login).toHaveBeenCalledWith('test-value');
  expect(state.register).toHaveBeenCalledOnce();
  expect(state.createBot).toHaveBeenCalledOnce();
  expect(state.listeners).toHaveBeenCalledExactlyOnceWith();
  expect(process.env['DISCORD_TOKEN']).toBeUndefined();
  expect(process.env['OPENAI_API_KEY']).toBeUndefined();
  expect(state.schedule).toHaveBeenCalledTimes(5);
  for (const call of state.schedule.mock.calls) {
    const [, , task] = call;
    if (typeof task !== 'function') throw new Error('Expected scheduled task.');
    await task();
  }
  expect(state.cleanup).toHaveBeenCalledOnce();
  expect(state.refreshToken).toHaveBeenCalledOnce();
  expect(state.globalRefresh).toHaveBeenCalledOnce();
  expect(state.guild.refreshClips).toHaveBeenCalledTimes(2);
  expect(state.guild.personalEmoteStore.refreshBTTVAndFFZPersonalEmotes).toHaveBeenCalledOnce();
});

test('missing credentials stop startup and close services without logging in', async () => {
  vi.stubEnv('APP_ID', '');
  const { startApplication } = await import('src/application.ts');
  await expect(startApplication()).rejects.toThrow('exit intercepted');
  expect(state.login).not.toHaveBeenCalled();
  expect(state.shutdown).toHaveBeenCalledOnce();
});

test('startup without optional credentials still logs in and schedules safe no-op token refresh', async () => {
  for (const name of [
    'OPENAI_API_KEY',
    'DEEPL_API_KEY',
    'TWITCH_CLIENT_ID',
    'TWITCH_SECRET',
    'MEILISEARCH_HOST',
    'MEILI_MASTER_KEY',
    'LOCAL_CACHE_BASE'
  ])
    vi.stubEnv(name, '');
  const { startApplication } = await import('src/application.ts');
  await startApplication();
  expect(state.token).not.toHaveBeenCalled();
  expect(state.login).toHaveBeenCalledOnce();
  const task = state.schedule.mock.calls.find(
    ([name]: readonly [string | symbol, ...unknown[]]) => name === 'refresh-twitch-token'
  )?.[2];
  if (task === undefined) throw new Error('Missing refresh task.');
  await task();
  expect(state.refreshToken).not.toHaveBeenCalled();
});

test.each(['prepare', 'token', 'globalInit', 'guildInit', 'update', 'login', 'register'] as const)(
  'shutdown during %s stops further startup and closes connections once',
  async (stage) => {
    vi.spyOn(process, 'exit').mockReturnValue(undefined as never);
    state[stage].mockImplementationOnce(async () => {
      const signal = vi
        .spyOn(process, 'once')
        .mock.calls.find(
          ([event]: readonly [string | symbol, ...unknown[]]) => event === 'SIGTERM'
        )?.[1];
      if (signal === undefined) throw new Error('Missing signal handler.');
      signal();
      signal();
      await Promise.resolve();
      return stage === 'guildInit' ? state.guild : undefined;
    });
    const { startApplication } = await import('src/application.ts');
    await startApplication();
    await vi.waitFor(() => {
      expect(vi.spyOn(process, 'exit')).toHaveBeenCalled();
    });
    const exit = vi
      .spyOn(process, 'once')
      .mock.calls.find(
        ([event]: readonly [string | symbol, ...unknown[]]) => event === 'exit'
      )?.[1];
    exit?.();
    expect(state.shutdown).toHaveBeenCalledOnce();
    expect(state.close).toHaveBeenCalledTimes(stage === 'prepare' || stage === 'token' ? 0 : 1);
    expect(state.schedule).not.toHaveBeenCalled();
  }
);
