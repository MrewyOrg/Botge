import type { AutocompleteInteraction } from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import type { ClipIndex } from 'src/api/twitch/clip-index.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { SLASH_COMMAND_NAMES } from 'src/discord/command-names.ts';
import { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import { autocompleteHandler } from 'src/handlers/interactions/autocomplete.ts';
import type { AssetInfo, Platform } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

type Choice = Readonly<{ name: string; value: string | number }>;
type Respond = (choices: readonly Choice[]) => Promise<void>;

function interaction(
  command: string,
  focus: string,
  text = '',
  values: Readonly<Record<string, string | boolean>> = {}
): Readonly<{ value: AutocompleteInteraction; respond: Mock<Respond> }> {
  const respond = vi.fn<Respond>().mockResolvedValue(undefined);
  return {
    value: {
      commandName: command,
      user: { id: 'owner' },
      options: {
        getFocused: (): Readonly<{ name: string; value: string }> => ({ name: focus, value: text }),
        get: (name: string): Readonly<{ value: string | boolean }> | null =>
          values[name] === undefined ? null : { value: values[name] }
      },
      respond
    } as unknown as AutocompleteInteraction,
    respond
  };
}

function emote(name: string, platform: Platform = 'sevenInSet'): AssetInfo {
  return {
    id: name,
    name,
    platform,
    url: 'https://example.com/image.png',
    animated: false,
    zeroWidth: false,
    isSevenTVPersonal: false,
    width: undefined,
    height: undefined,
    frameCount: undefined,
    timestamp: undefined
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each([
  ['bttv', [1, 2, 3]],
  ['twitch', [1, 2, 3]],
  ['ffz', [1, 2, 4]],
  ['sevenInSet', [1, 2, 3, 4]]
] as const)(
  'size choices use the selected name and respect provider limits: %s',
  async (platform, expected) => {
    const catalog = new EmoteCatalog(() => [[emote('Selected', platform)]]);
    const target = interaction(SLASH_COMMAND_NAMES.emote, 'size', '', { name: 'Selected' });
    await autocompleteHandler(
      catalog,
      undefined,
      undefined,
      undefined,
      {} as Readonly<DatabaseManager>
    )(target.value);
    const [choices] = requireValue(target.respond.mock.calls[0], 'Expected size response.');
    expect(choices.map((choice) => choice.value)).toEqual(expected);
  }
);

test('emote suggestions are limited to Discord’s 25 choices', async () => {
  const catalog = new EmoteCatalog(() => [
    Array.from({ length: 40 }, (_, index) => emote(`Emote${index}`))
  ]);
  const target = interaction(SLASH_COMMAND_NAMES.emote, 'name', 'Emote');
  await autocompleteHandler(
    catalog,
    undefined,
    undefined,
    undefined,
    {} as Readonly<DatabaseManager>
  )(target.value);
  const [choices] = requireValue(target.respond.mock.calls[0], 'Expected emote response.');
  expect(choices).toHaveLength(25);
});

test.each([SLASH_COMMAND_NAMES.media, SLASH_COMMAND_NAMES.quote])(
  'saved-name suggestions match mixed case and retain original names: %s',
  async (command) => {
    const records = [{ name: 'MixedCase' }, { name: 'other' }];
    const database = {
      mediaDatabase: { getAllMedia: vi.fn().mockReturnValue(records) },
      quoteDatabase: { getAllQuote: vi.fn().mockReturnValue(records) }
    } as unknown as Readonly<DatabaseManager>;
    const target = interaction(command, 'name', ' MIXED ');
    await autocompleteHandler(
      new EmoteCatalog(() => []),
      undefined,
      undefined,
      undefined,
      database
    )(target.value);
    expect(target.respond).toHaveBeenCalledWith([{ name: 'MixedCase', value: 'MixedCase' }]);
  }
);

test('platform choices reflect matching emotes without duplicate providers', async () => {
  const catalog = new EmoteCatalog(() => [
    [emote('one', 'bttv'), emote('two', 'bttv'), emote('three', 'ffz')]
  ]);
  const target = interaction(SLASH_COMMAND_NAMES.emoteList, 'platform');
  await autocompleteHandler(
    catalog,
    undefined,
    undefined,
    undefined,
    {} as Readonly<DatabaseManager>
  )(target.value);
  expect(target.respond).toHaveBeenCalledWith([
    { name: 'BTTV', value: 'BTTV' },
    { name: 'FFZ', value: 'FFZ' }
  ]);
});

test.each(['animated', 'overlaying'])(
  'boolean suggestions reflect the catalog: %s',
  async (focus) => {
    const catalog = new EmoteCatalog(() => [
      [emote('plain'), { ...emote('animated'), animated: true, zeroWidth: true }]
    ]);
    const target = interaction(SLASH_COMMAND_NAMES.emoteList, focus);
    await autocompleteHandler(
      catalog,
      undefined,
      undefined,
      undefined,
      {} as Readonly<DatabaseManager>
    )(target.value);
    expect(target.respond).toHaveBeenCalledWith([
      { name: 'No', value: 'No' },
      { name: 'Yes', value: 'Yes' }
    ]);
  }
);

test('clip title suggestions honor selected creator and game filters', async () => {
  const index = {
    getPagination: vi.fn().mockResolvedValue({ maxTotalHits: 10 }),
    search: vi.fn().mockResolvedValue({
      hits: [
        { title: 'match', creator_name: 'chosen', game_id: 'game' },
        { title: 'wrong game', creator_name: 'chosen', game_id: 'other' },
        { title: 'wrong creator', creator_name: 'other', game_id: 'game' }
      ]
    })
  } as unknown as ClipIndex;
  const target = interaction(SLASH_COMMAND_NAMES.clip, 'title', 'm', {
    clipper: 'chosen',
    category: 'game'
  });
  await autocompleteHandler(
    new EmoteCatalog(() => []),
    index,
    ['chosen'],
    ['game'],
    {} as Readonly<DatabaseManager>
  )(target.value);
  expect(target.respond).toHaveBeenCalledWith([{ name: 'match', value: 'match' }]);
});

test.each(['clipper', 'category'])(
  'clip metadata suggestions compare focused text without case sensitivity: %s',
  async (focus) => {
    const target = interaction(SLASH_COMMAND_NAMES.clip, focus, ' MIXED ');
    const index = {} as ClipIndex;
    await autocompleteHandler(
      new EmoteCatalog(() => []),
      index,
      ['MixedCreator'],
      ['MixedGame'],
      {} as Readonly<DatabaseManager>
    )(target.value);
    const expected = focus === 'clipper' ? 'MixedCreator' : 'MixedGame';
    expect(target.respond).toHaveBeenCalledWith([{ name: expected, value: expected }]);
  }
);

test('timezone suggestions ignore surrounding whitespace and case', async () => {
  const target = interaction(SLASH_COMMAND_NAMES.pingList, 'timezone', ' TOKYO ');
  await autocompleteHandler(
    new EmoteCatalog(() => []),
    undefined,
    undefined,
    undefined,
    {} as Readonly<DatabaseManager>
  )(target.value);
  const [choices] = requireValue(target.respond.mock.calls[0], 'Expected timezone response.');
  expect(choices.length).toBeGreaterThan(0);
  expect(choices.every((choice) => choice.name.toLowerCase().includes('tokyo'))).toBe(true);
});

test.each([true, false])(
  'emote list queries filter the catalog and return an empty list for no matches: %s',
  async (found) => {
    const catalog = new EmoteCatalog(() => [[emote('Matching', 'bttv')]]);
    const target = interaction(
      SLASH_COMMAND_NAMES.emoteList,
      'query',
      found ? 'Matching' : 'missing',
      { platform: 'BTTV', animated: 'No', overlaying: 'No' }
    );
    await autocompleteHandler(
      catalog,
      undefined,
      undefined,
      undefined,
      {} as DatabaseManager
    )(target.value);
    expect(target.respond).toHaveBeenCalledWith(
      found ? [{ name: 'Matching', value: 'Matching' }] : []
    );
  }
);

test.each(['clipper', 'category'])(
  'clip metadata can be narrowed by the selected title and other field: %s',
  async (focus) => {
    const hits = [
      { title: 'one', creator_name: 'first', game_id: 'game' },
      { title: 'two', creator_name: 'second', game_id: 'other' }
    ];
    for (const narrow of [true, false]) {
      const index = {
        getPagination: vi.fn().mockResolvedValue({ maxTotalHits: 10 }),
        search: vi.fn().mockResolvedValue({ hits })
      } as unknown as ClipIndex;
      const values = {
        title: 'text',
        ...(narrow ?
          focus === 'clipper' ?
            { category: 'game' }
          : { clipper: 'first' }
        : {})
      };
      const target = interaction(SLASH_COMMAND_NAMES.clip, focus, '', values);
      await autocompleteHandler(
        new EmoteCatalog(() => []),
        index,
        [],
        [],
        {} as DatabaseManager
      )(target.value);
      expect(target.respond.mock.calls[0]?.[0]).toHaveLength(narrow ? 1 : 2);
    }
  }
);

test.each(['cat do', 'dog cat', 'missing do'])(
  'shortest substring completion handles preceding tokens: %s',
  async (text) => {
    const catalog = new EmoteCatalog(() => [['cat', 'catalog', 'dog'].map((name) => emote(name))]);
    const target = interaction(SLASH_COMMAND_NAMES.shortestUniqueSubstrings, 'emotes', text);
    await autocompleteHandler(
      catalog,
      undefined,
      undefined,
      undefined,
      {} as DatabaseManager
    )(target.value);
    expect(target.respond).toHaveBeenCalledOnce();
    expect(target.respond.mock.calls[0]?.[0].length).toBeGreaterThan(0);
  }
);

test('overlong completion labels are withheld from Discord', async () => {
  const catalog = new EmoteCatalog(() => [[emote('x'.repeat(110))]]);
  const target = interaction(SLASH_COMMAND_NAMES.shortestUniqueSubstrings, 'emotes', 'x');
  await autocompleteHandler(
    catalog,
    undefined,
    undefined,
    undefined,
    {} as DatabaseManager
  )(target.value);
  expect(target.respond).not.toHaveBeenCalled();
});

test.each([
  SLASH_COMMAND_NAMES.emote,
  SLASH_COMMAND_NAMES.emoteList,
  SLASH_COMMAND_NAMES.clip,
  SLASH_COMMAND_NAMES.shortestUniqueSubstrings,
  SLASH_COMMAND_NAMES.pingList,
  SLASH_COMMAND_NAMES.media,
  SLASH_COMMAND_NAMES.quote,
  'unknown'
])('unsupported focus is ignored for %s', async (command) => {
  const target = interaction(command, 'unsupported');
  await autocompleteHandler(
    new EmoteCatalog(() => []),
    {} as ClipIndex,
    [],
    [],
    {} as DatabaseManager
  )(target.value);
  expect(target.respond).not.toHaveBeenCalled();
});

test('size choices have a default when no emote has been selected', async () => {
  const target = interaction(SLASH_COMMAND_NAMES.emote, 'size');
  await autocompleteHandler(
    new EmoteCatalog(() => []),
    undefined,
    undefined,
    undefined,
    {} as DatabaseManager
  )(target.value);
  expect(target.respond.mock.calls[0]?.[0].map((choice) => choice.value)).toEqual([1, 2, 3, 4]);
});
