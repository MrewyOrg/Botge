import type { ChatInputCommandInteraction } from 'discord.js';
import { expect, test, vi } from 'vitest';

import type { Guild } from 'src/discord/guild.ts';
import { EmoteCatalog } from 'src/emotes/emote-catalog.ts';
import { twitchToAsset } from 'src/emotes/emote-to-asset.ts';
import {
  getShortestUniqueSubstrings,
  shortestUniqueSubstringsHandler
} from 'src/handlers/commands/shortest-unique-substrings.ts';
import type { EmoteMessageBuilder } from 'src/message-builders/emote-message-builder.ts';

test('shortest unique substrings are deduplicated even when letters repeat', () => {
  const catalog = new EmoteCatalog(() => [
    [
      {
        id: '1',
        name: 'aaaa',
        url: 'https://example.com/a.png',
        platform: 'bttv',
        zeroWidth: false,
        animated: false,
        width: undefined,
        height: undefined,
        frameCount: undefined,
        timestamp: undefined,
        isSevenTVPersonal: false
      }
    ]
  ]);
  expect(getShortestUniqueSubstrings(catalog, 'aaaa')).toEqual(['aaaa', ['a']]);
  expect(getShortestUniqueSubstrings(catalog, 'missing')).toEqual([undefined, undefined]);
});

test.each([false, true])(
  'shortest substring commands produce text or an emote page: %s',
  async (rich) => {
    const catalog = new EmoteCatalog(() => [
      ['cat', 'catalog', 'dog'].map((name) =>
        twitchToAsset({ id: name, name, format: ['static'], theme_mode: ['dark'] })
      )
    ]);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const values: Readonly<Record<string, string | boolean>> = {
      emotes: 'cat dog missing',
      ephemeral: true,
      ...(rich ? { format: 'embed' } : {})
    };
    const interaction = {
      editReply,
      deferReply,
      options: {
        get: (name: string): Readonly<{ value: string | boolean }> | null => {
          const value = values[name];
          return value === undefined ? null : { value };
        }
      }
    } as unknown as ChatInputCommandInteraction;
    const builders: Readonly<EmoteMessageBuilder>[] = [];
    await shortestUniqueSubstringsHandler(builders)(interaction, {
      emoteCatalog: catalog
    } as unknown as Readonly<Guild>);
    expect(deferReply).toHaveBeenCalledWith({ flags: 'Ephemeral' });
    expect(builders).toHaveLength(rich ? 1 : 0);
    if (rich) expect(editReply).toHaveBeenCalledOnce();
    else {
      expect(editReply).toHaveBeenCalledWith(expect.stringContaining('cat: -'));
      expect(editReply).toHaveBeenCalledWith(
        expect.stringContaining("Could not find emote 'missing'.")
      );
    }
  }
);

test('plain substring output includes multiple equally short alternatives', async () => {
  const catalog = new EmoteCatalog(() => [
    [twitchToAsset({ id: 'abc', name: 'abc', format: ['static'], theme_mode: ['dark'] })]
  ]);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    editReply,
    deferReply,
    options: {
      get: (name: string): Readonly<{ value: string }> | null =>
        name === 'emotes' ? { value: 'abc' } : null
    }
  } as unknown as ChatInputCommandInteraction;
  await shortestUniqueSubstringsHandler([])(interaction, {
    emoteCatalog: catalog
  } as unknown as Guild);
  expect(editReply).toHaveBeenCalledWith('abc: a, b, c');
  expect(deferReply).toHaveBeenCalledWith();
});

test('a short unique match avoids scanning longer substring candidates', () => {
  const targetName = 'Z' + 'a'.repeat(79);
  const catalog = new EmoteCatalog(() => [
    ['a'.repeat(80), targetName].map((name) =>
      twitchToAsset({ id: name, name, format: ['static'], theme_mode: ['dark'] })
    )
  ]);
  const search = vi.spyOn(catalog, 'matchSingleUnique');
  try {
    expect(getShortestUniqueSubstrings(catalog, targetName)).toEqual([targetName, ['Z']]);
    expect(search.mock.calls.length).toBeLessThanOrEqual(targetName.length);
  } finally {
    search.mockRestore();
  }
});
