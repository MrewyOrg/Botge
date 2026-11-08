// cspell:words generla

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { GENERAL_DEFAULTS, loadConfig, parseConfig } from 'src/config/load-config.ts';
import { CONTEXT_MENU_COMMAND_NAMES, SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';

import { loadEnabledExampleConfig } from './example-config.ts';

test('provider loading is opt-in and explicit true values still work', () => {
  const defaults = parseConfig({}).general;
  expect(defaults).toMatchObject({
    updateClipsOnStartup: false,
    joinVoiceChannels: false,
    autoCompleteOnly7TVPersonal: false,
    use7TVGlobalEmotes: false,
    use7TVPersonalEmotes: false,
    use7TVAddedEmotes: false,
    useBTTVEmotes: false,
    useFFZEmotes: false,
    useTwitchEmotes: false
  });
  const enabledProviders = {
    use7TVGlobalEmotes: true,
    use7TVPersonalEmotes: true,
    use7TVAddedEmotes: true,
    useBTTVEmotes: true,
    useFFZEmotes: true,
    useTwitchEmotes: true
  };
  expect(parseConfig({ general: enabledProviders }).general).toMatchObject(enabledProviders);
  expect(loadConfig('botge.example.config.jsonc').general).toEqual(defaults);
});

test('minimal config applies schema defaults and preserves explicit false and empty lists', () => {
  expect(parseConfig({})).toEqual({ general: GENERAL_DEFAULTS, ollama: { enabled: false } });
  expect(
    parseConfig({ general: { useBTTVEmotes: false, activeSlashCommands: [] } }).general
  ).toMatchObject({ useBTTVEmotes: false, activeSlashCommands: [] });
  const schema = JSON.parse(readFileSync('botge.config.schema.json', 'utf8')) as {
    readonly properties: {
      readonly general: {
        readonly properties: Readonly<
          Record<
            string,
            { readonly default: unknown; readonly items?: { readonly enum: readonly string[] } }
          >
        >;
      };
    };
  };
  expect(
    Object.fromEntries(
      Object.entries(schema.properties.general.properties).map(
        ([key, value]: readonly [string, { readonly default: unknown }]) => [key, value.default]
      )
    )
  ).toEqual(GENERAL_DEFAULTS);
  expect(schema.properties.general.properties['activeSlashCommands']?.items?.enum).toEqual(
    Object.values(SLASH_COMMAND_NAMES)
  );
  expect(schema.properties.general.properties['activeContextMenuCommands']?.items?.enum).toEqual(
    Object.values(CONTEXT_MENU_COMMAND_NAMES)
  );
});

test.each([
  null,
  [],
  { generla: {} },
  { $schema: 42 },
  { ollama: { enabled: false, baseUrl: 'file:///tmp/model' } },
  { ollama: { enabled: false, options: { top_p: 2 } } },
  { ollama: { enabled: false, chroma: { url: 'http://localhost', typo: true } } },
  { ollama: { enabled: false, activeChatChannels: ['invalid'] } },
  { general: null },
  { general: { useBTTVEmotes: undefined } },
  { general: { useBTTVEmotes: 'false' } },
  { general: { activeSlashCommands: ['missing'] } },
  { general: { activeSlashCommands: ['emote', 'emote'] } },
  { general: { activeSlashCommands: ['pingme', 'remind'] } },
  { general: { activeSlashCommands: [42] } },
  { general: { activeSlashCommands: 'emote' } },
  { general: { activeContextMenuCommands: ['Add Media', 'Save Media'] } },
  { general: { activeContextMenuCommands: ['toString'] } },
  { ollama: { enabled: true } }
])('rejects invalid configuration %# before service construction', (config: unknown) => {
  expect(() => parseConfig(config)).toThrow();
});

test('example configuration loads without external services or credentials', () => {
  expect(loadConfig('botge.example.config.jsonc').ollama.enabled).toBe(false);
});

test.each([
  ['{ /* block comment */ "ollama": { "enabled": false, }, // line comment\n}', false],
  ['{"ollama":{"enabled":false,"baseUrl":"http://localhost:11434/path//value/*text*/"}}', false],
  ['{"ollama":{"enabled":false}, broken}', true],
  ['{"ollama":{"enabled":false}} trailing', true],
  ['{/* unterminated', true],
  ['', true]
] as const)('loads JSON and JSONC while rejecting malformed syntax: %#', (source, invalid) => {
  const directory = mkdtempSync(join(tmpdir(), 'botge-config-'));
  try {
    const path = join(directory, 'botge.config.json');
    writeFileSync(path, source);
    if (invalid) expect(() => loadConfig(path)).toThrow('Invalid configuration syntax:');
    else expect(loadConfig(path).ollama.enabled).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy command lists migrate without mutating the input or enabling extra commands', () => {
  const general = Object.freeze({
    activeSlashCommands: Object.freeze([
      'emotes',
      'emotelist',
      'addemote',
      'shortestuniquesubstrings',
      'transient',
      'findtheemoji',
      'pingme',
      'pinglist',
      'poe2',
      'medialist',
      'quotelist',
      'clear',
      'emote'
    ]),
    activeContextMenuCommands: Object.freeze([
      'ChatGPT Explain',
      'Add Media',
      'Remove Media',
      'Translate',
      'Add Quote',
      'Remove Quote'
    ])
  });
  expect(parseConfig({ general }).general).toMatchObject({
    activeSlashCommands: [
      SLASH_COMMAND_NAMES.emotes,
      SLASH_COMMAND_NAMES.emoteList,
      SLASH_COMMAND_NAMES.addEmote,
      SLASH_COMMAND_NAMES.shortestUniqueSubstrings,
      SLASH_COMMAND_NAMES.transient,
      SLASH_COMMAND_NAMES.findTheEmoji,
      SLASH_COMMAND_NAMES.pingMe,
      SLASH_COMMAND_NAMES.pingList,
      SLASH_COMMAND_NAMES.poe2,
      SLASH_COMMAND_NAMES.mediaList,
      SLASH_COMMAND_NAMES.quoteList,
      SLASH_COMMAND_NAMES.clear,
      SLASH_COMMAND_NAMES.emote
    ],
    activeContextMenuCommands: Object.values(CONTEXT_MENU_COMMAND_NAMES)
  });
  expect(general.activeSlashCommands[0]).toBe('emotes');
  expect(general.activeContextMenuCommands[0]).toBe('ChatGPT Explain');
  expect(
    parseConfig({
      general: { activeSlashCommands: ['remind'], activeContextMenuCommands: ['Save Media'] }
    }).general
  ).toMatchObject({ activeSlashCommands: ['remind'], activeContextMenuCommands: ['Save Media'] });
});

test('enabled Ollama example is complete and invalid numeric settings fail early', () => {
  const config = loadEnabledExampleConfig();
  expect(config.ollama.enabled).toBe(true);
  if (!config.ollama.enabled) throw new Error('Expected enabled example.');
  const { ollama } = config;
  expect(() =>
    parseConfig({ ollama: { ...ollama, behavior: { ...ollama.behavior, evaluationChance: 2 } } })
  ).toThrow('evaluationChance');
  expect(() => parseConfig({ ollama: { ...ollama, baseUrl: 'file:///tmp/model' } })).toThrow(
    'HTTP(S)'
  );
});

test('disabled Ollama accepts valid partial settings for later setup', () => {
  expect(parseConfig({ ollama: { enabled: false, model: 'example' } }).ollama.enabled).toBe(false);
});

test.each([
  ['options', 'temperature', -0.1],
  ['options', 'num_ctx', 0],
  ['options', 'num_ctx', 1.5],
  ['options', 'top_p', 1.01],
  ['behavior', 'replyScoreThreshold', -1],
  ['behavior', 'replyScoreThreshold', 11],
  ['behavior', 'contextWindow', 0],
  ['behavior', 'contextWindow', 1.5],
  ['behavior', 'evaluationChance', -0.1],
  ['behavior', 'cooldownSeconds', -1],
  ['behavior', 'ragResults', -1],
  ['behavior', 'ragResults', 0.5],
  ['behavior', 'ragWindowSize', -1],
  ['behavior', 'ragWindowSize', 0.5],
  ['behavior', 'cooldownSeconds', Infinity],
  ['behavior', 'evaluationChance', NaN]
] as const)('rejects invalid %s.%s value %s', (section, key, value) => {
  const config = loadEnabledExampleConfig();
  if (!config.ollama.enabled) throw new Error('Expected enabled example.');
  const { ollama } = config;
  expect(() =>
    parseConfig({ ollama: { ...ollama, [section]: { ...ollama[section], [key]: value } } })
  ).toThrow(`ollama.${section}.${key}`);
});

test('inclusive numeric boundaries and disabled retrieval remain valid', () => {
  const config = loadEnabledExampleConfig();
  if (!config.ollama.enabled) throw new Error('Expected enabled example.');
  const ollama = {
    ...config.ollama,
    options: { temperature: 0, num_ctx: 1, top_p: 0 },
    behavior: {
      replyScoreThreshold: 10,
      contextWindow: 1,
      evaluationChance: 1,
      cooldownSeconds: 0,
      ragResults: 0,
      ragWindowSize: 0
    },
    activeChatChannels: ['12345678901234567', '12345678901234567890']
  };
  expect(parseConfig({ ollama }).ollama).toEqual(ollama);
});

test.each([
  { chroma: { url: 'ftp://example.com' } },
  { systemPrompts: { scoreReplyOpportunity: [], generateReply: ['reply'] } },
  { systemPrompts: { scoreReplyOpportunity: [1], generateReply: ['reply'] } },
  { activeChatChannels: ['12345678901234567', '12345678901234567'] },
  { activeChatChannels: [1234567890123456] },
  { activeChatChannels: ['1234567890123456'] },
  { model: '   ' },
  { behavior: { unexpected: true } }
])(
  'rejects malformed nested settings even when disabled: %#',
  (settings: Readonly<Record<string, unknown>>) => {
    expect(() => parseConfig({ ollama: { enabled: false, ...settings } })).toThrow();
  }
);

test.each(['use7TVGlobalEmotes', 'use7TVPersonalEmotes', 'use7TVAddedEmotes'] as const)(
  '7TV option %s can be enabled without enabling other sources',
  (setting) => {
    const { general } = parseConfig({ general: { [setting]: true } });
    expect(general).toEqual({ ...GENERAL_DEFAULTS, [setting]: true });
  }
);
