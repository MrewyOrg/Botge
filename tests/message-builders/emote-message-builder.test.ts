import type { ChatInputCommandInteraction } from 'discord.js';
import { expect, test } from 'vitest';

import { EmoteMessageBuilder } from 'src/message-builders/emote-message-builder.ts';
import type { AssetInfo } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

const emotes: readonly AssetInfo[] = ['Alpha', 'Bravo', 'Charlie'].map((name) => ({
  id: name,
  name,
  platform: 'sevenNotInSet',
  url: `https://cdn.7tv.app/emote/${name}/2x.png`,
  zeroWidth: false,
  animated: false,
  width: 64,
  height: 32,
  frameCount: 1,
  timestamp: undefined,
  isSevenTVPersonal: false
}));
function createBuilder(): EmoteMessageBuilder {
  return new EmoteMessageBuilder({} as ChatInputCommandInteraction, emotes, undefined, true);
}

test('renders emote details and page position from complete provider data', () => {
  const builder = createBuilder();
  const page = builder.first();
  expect(requireValue(page?.embeds[0], 'Expected indexed test value.').toJSON()).toMatchObject({
    title: 'Alpha',
    url: 'https://7tv.app/emotes/Alpha',
    image: { url: requireValue(emotes[0], 'Expected indexed test value.').url },
    footer: { text: '1/3. Sorted alphabetically.' }
  });
  expect(builder.previous()).toBeUndefined();
  expect(
    requireValue(builder.last()?.embeds[0], 'Expected indexed test value.').toJSON().title
  ).toBe('Charlie');
  expect(builder.next()).toBeUndefined();
});

test.each(['Bravo', 'bravo', 'rav'])('finds emote identifier %s independently', (identifier) => {
  const builder = createBuilder();
  builder.first();
  expect(
    requireValue(
      builder.jumpToIdentifier(identifier)?.embeds[0],
      'Expected indexed test value.'
    ).toJSON().title
  ).toBe('Bravo');
  expect(builder.jumpToIdentifier(identifier)).toBeUndefined();
});

test('deleting an added emote updates its page and prevents a repeated deletion', () => {
  const builder = createBuilder();
  builder.first();
  expect(builder.currentAddedEmote).toEqual({
    url: 'https://7tv.io/v3/emotes/Alpha',
    alias: 'Alpha'
  });
  expect(
    requireValue(builder.markCurrentAsDeleted()?.embeds[0], 'Expected indexed test value.').toJSON()
      .description
  ).toContain('DELETED');
  expect(builder.markCurrentAsDeleted()).toBeUndefined();
  expect(builder.currentAddedEmote).toBeUndefined();
});

test.each([undefined, '', 'short'])(
  'standard emote pages render optional shortest substrings: %s',
  (text) => {
    const original = requireValue(emotes[0], 'Expected emote.');
    const builder = new EmoteMessageBuilder(
      {} as ChatInputCommandInteraction,
      [{ ...original, width: undefined, height: undefined, timestamp: 123 }],
      text === undefined ? [] : [text]
    );
    const page = builder.first();
    expect(page?.components).toHaveLength(1);
    expect(page?.embeds[0]?.toJSON().fields).toContainEqual({
      name: 'Shortest Unique Substrings',
      value: text === undefined || text === '' ? '-' : text
    });
    expect(builder.currentAddedEmote).toBeUndefined();
    expect(builder.markCurrentAsDeleted()).toBeUndefined();
  }
);
