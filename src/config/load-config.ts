import { readFileSync } from 'node:fs';

import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

import { CONTEXT_MENU_COMMAND_NAMES, SLASH_COMMAND_NAMES } from '../discord/command-names.ts';
import type { BotgeConfig, MutableArray } from '../types.ts';
import { isRecord } from '../utils/validation.ts';

export const GENERAL_DEFAULTS: BotgeConfig['general'] = {
  updateClipsOnStartup: false,
  autoCompleteOnly7TVPersonal: false,
  use7TVGlobalEmotes: false,
  use7TVPersonalEmotes: false,
  use7TVAddedEmotes: false,
  useBTTVEmotes: false,
  useFFZEmotes: false,
  useTwitchEmotes: false,
  activeSlashCommands: Object.values(SLASH_COMMAND_NAMES),
  activeContextMenuCommands: Object.values(CONTEXT_MENU_COMMAND_NAMES)
};

// Accept existing explicit command lists while registering only the current names.
const LEGACY_SLASH_COMMAND_NAMES: Readonly<Record<string, string>> = {
  emotes: SLASH_COMMAND_NAMES.emotes,
  emotelist: SLASH_COMMAND_NAMES.emoteList,
  addemote: SLASH_COMMAND_NAMES.addEmote,
  shortestuniquesubstrings: SLASH_COMMAND_NAMES.shortestUniqueSubstrings,
  transient: SLASH_COMMAND_NAMES.transient,
  findtheemoji: SLASH_COMMAND_NAMES.findTheEmoji,
  pingme: SLASH_COMMAND_NAMES.pingMe,
  pinglist: SLASH_COMMAND_NAMES.pingList,
  poe2: SLASH_COMMAND_NAMES.poe2,
  medialist: SLASH_COMMAND_NAMES.mediaList,
  quotelist: SLASH_COMMAND_NAMES.quoteList,
  clear: SLASH_COMMAND_NAMES.clear
};

const LEGACY_CONTEXT_MENU_COMMAND_NAMES: Readonly<Record<string, string>> = {
  'ChatGPT Explain': CONTEXT_MENU_COMMAND_NAMES.chatGptExplain,
  'Add Media': CONTEXT_MENU_COMMAND_NAMES.addMedia,
  'Remove Media': CONTEXT_MENU_COMMAND_NAMES.removeMedia,
  'Translate': CONTEXT_MENU_COMMAND_NAMES.translate,
  'Add Quote': CONTEXT_MENU_COMMAND_NAMES.addQuote,
  'Remove Quote': CONTEXT_MENU_COMMAND_NAMES.removeQuote
};

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  return value;
}
function knownKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`Unknown configuration option: ${path}.${key}`);
  }
}

function validateGeneral(value: unknown): asserts value is Partial<BotgeConfig['general']> {
  const general = object(value, 'general');
  knownKeys(general, Object.keys(GENERAL_DEFAULTS), 'general');
  for (const [key, fallback] of Object.entries(GENERAL_DEFAULTS)) {
    const entry = general[key];
    if (!Object.hasOwn(general, key)) continue;
    if (typeof fallback === 'boolean') {
      if (typeof entry !== 'boolean') throw new Error(`general.${key} must be a boolean.`);
    } else if (
      !Array.isArray(entry)
      || entry.some((name: unknown) => typeof name !== 'string' || !fallback.includes(name))
      || new Set(entry).size !== entry.length
    ) {
      throw new Error(`general.${key} must contain unique, known command names.`);
    }
  }
}

function validateOllama(value: unknown): asserts value is BotgeConfig['ollama'] {
  const ollama = object(value, 'ollama');
  if (typeof ollama['enabled'] !== 'boolean') throw new Error('ollama.enabled must be a boolean.');
  knownKeys(
    ollama,
    [
      'enabled',
      'botName',
      'baseUrl',
      'model',
      'embeddingModel',
      'options',
      'systemPrompts',
      'behavior',
      'chroma',
      'activeChatChannels'
    ],
    'ollama'
  );
  for (const key of ['botName', 'baseUrl', 'model', 'embeddingModel']) {
    const entry = ollama[key];
    if (!ollama['enabled'] && entry === undefined) continue;
    if (typeof entry !== 'string' || entry.trim() === '')
      throw new Error(`ollama.${key} must be a nonempty string.`);
  }
  const checkUrl = (entry: unknown, path: string): void => {
    if (
      typeof entry !== 'string'
      || !URL.canParse(entry)
      || !['http:', 'https:'].includes(new URL(entry).protocol)
    )
      throw new Error(`${path} must be an HTTP(S) URL.`);
  };
  if (ollama['enabled'] || ollama['baseUrl'] !== undefined)
    checkUrl(ollama['baseUrl'], 'ollama.baseUrl');
  if (ollama['enabled'] || ollama['chroma'] !== undefined) {
    const chroma = object(ollama['chroma'], 'ollama.chroma');
    knownKeys(chroma, ['url'], 'ollama.chroma');
    checkUrl(chroma['url'], 'ollama.chroma.url');
  }
  if (ollama['enabled'] || ollama['systemPrompts'] !== undefined) {
    const prompts = object(ollama['systemPrompts'], 'ollama.systemPrompts');
    const promptKeys = ['scoreReplyOpportunity', 'generateReply'];
    knownKeys(prompts, promptKeys, 'ollama.systemPrompts');
    for (const key of promptKeys) {
      const lines = prompts[key];
      if (
        !Array.isArray(lines)
        || lines.length === 0
        || lines.some((line: unknown) => typeof line !== 'string')
      )
        throw new Error(`ollama.systemPrompts.${key} must be a nonempty array of strings.`);
    }
  }
  for (const [section, limits] of Object.entries({
    options: {
      temperature: [0, Infinity, false],
      num_ctx: [1, Infinity, true],
      top_p: [0, 1, false]
    },
    behavior: {
      replyScoreThreshold: [0, 10, false],
      contextWindow: [1, Infinity, true],
      evaluationChance: [0, 1, false],
      cooldownSeconds: [0, Infinity, false],
      ragResults: [0, Infinity, true],
      ragWindowSize: [0, Infinity, true]
    }
  } as const)) {
    if (!ollama['enabled'] && ollama[section] === undefined) continue;
    const settings = object(ollama[section], `ollama.${section}`);
    knownKeys(settings, Object.keys(limits), `ollama.${section}`);
    for (const [key, [minimum, maximum, integer]] of Object.entries(limits)) {
      const entry = settings[key];
      if (
        typeof entry !== 'number'
        || !Number.isFinite(entry)
        || entry < minimum
        || entry > maximum
        || (integer && !Number.isInteger(entry))
      )
        throw new Error(`Invalid ollama.${section}.${key}.`);
    }
  }
  if (ollama['enabled'] || ollama['activeChatChannels'] !== undefined) {
    const channels = ollama['activeChatChannels'];
    if (
      !Array.isArray(channels)
      || channels.some((id: unknown) => typeof id !== 'string' || !/^\d{17,20}$/u.test(id))
      || new Set(channels).size !== channels.length
    )
      throw new Error(
        'ollama.activeChatChannels must contain unique Discord channel IDs as strings.'
      );
  }
}

/** Apply defaults without treating explicit false or empty command lists as missing. */
export function parseConfig(value: unknown): BotgeConfig {
  const root = object(value, 'config');
  knownKeys(root, ['$schema', 'general', 'ollama'], 'config');
  if (root['$schema'] !== undefined && typeof root['$schema'] !== 'string')
    throw new Error('config.$schema must be a string.');
  const general = { ...object(root['general'] === undefined ? {} : root['general'], 'general') };
  // Ignore the retired option so existing installations can start and configure voice in Discord.
  delete general['joinVoiceChannels'];
  for (const [key, aliases] of [
    ['activeSlashCommands', LEGACY_SLASH_COMMAND_NAMES],
    ['activeContextMenuCommands', LEGACY_CONTEXT_MENU_COMMAND_NAMES]
  ] as const) {
    const names = general[key];
    if (Array.isArray(names)) {
      general[key] = names.map((name: unknown) =>
        typeof name === 'string' && Object.hasOwn(aliases, name) ? aliases[name] : name
      );
    }
  }
  validateGeneral(general);
  const ollama: unknown = root['ollama'] === undefined ? { enabled: false } : root['ollama'];
  validateOllama(ollama);
  return { general: { ...GENERAL_DEFAULTS, ...general }, ollama };
}

export function loadConfig(path = 'botge.config.json'): BotgeConfig {
  const errors: MutableArray<ParseError> = [];
  const value: unknown = parse(readFileSync(path, 'utf8'), errors, { allowTrailingComma: true });
  const [error] = errors;
  if (error !== undefined) {
    throw new Error(
      `Invalid configuration syntax: ${printParseErrorCode(error.error)} at offset ${error.offset}.`
    );
  }
  return parseConfig(value);
}
