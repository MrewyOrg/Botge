import type { ChatInputCommandInteraction } from 'discord.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  BaseMessageBuilder,
  getBaseCustomIdFromCustomId,
  getCounterFromCustomId,
  getCustomId,
  getMessageBuilderTypeFromCustomId
} from 'src/message-builders/base.ts';
import { EmoteMessageBuilder } from 'src/message-builders/emote-message-builder.ts';
import { MediaMessageBuilder } from 'src/message-builders/media-message-builder.ts';
import { PingForPingListMessageBuilder } from 'src/message-builders/ping-for-ping-list-message-builder.ts';
import { QuoteMessageBuilder } from 'src/message-builders/quote-message-builder.ts';

const interaction = {} as ChatInputCommandInteraction;

class NumberMessageBuilder extends BaseMessageBuilder<number, string> {
  public constructor(items: readonly number[]) {
    super(0, 'Test', interaction, items, String, String, 'number');
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('List navigation', () => {
  test('empty lists have no navigable page', () => {
    const builder = new NumberMessageBuilder([]);
    expect(builder.first()).toBeUndefined();
    expect(builder.last()).toBeUndefined();
    expect(builder.next()).toBeUndefined();
    expect(builder.previous()).toBeUndefined();
    expect(builder.random()).toBeUndefined();
    expect(builder.jumpTo(0)).toBeUndefined();
  });

  test.each([NaN, Infinity, -Infinity, 0.5, -1, 2])(
    'rejects invalid index %s without losing the current page',
    (index) => {
      const builder = new NumberMessageBuilder([10, 20]);
      expect(builder.first()).toBe('10');
      expect(builder.jumpTo(index)).toBeUndefined();
      expect(builder.next()).toBe('20');
    }
  );

  test('random selects an uninitialized singleton exactly once', () => {
    const builder = new NumberMessageBuilder([10]);
    expect(builder.random()).toBe('10');
    expect(builder.random()).toBeUndefined();
  });

  test('random always selects another page without retrying the RNG', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const builder = new NumberMessageBuilder([10, 20]);
    builder.first();
    expect(builder.random()).toBe('20');
    expect(random).toHaveBeenCalledOnce();
    expect(builder.random()).toBe('10');
  });

  test('navigation uses a snapshot of the supplied array', () => {
    const items = [10, 20];
    const builder = new NumberMessageBuilder(items);
    items.length = 0;
    expect(builder.first()).toBe('10');
    expect(builder.next()).toBe('20');
  });

  test('deletion is safe before selecting a page and for empty lists', () => {
    const builders = [
      new MediaMessageBuilder(interaction, [], undefined),
      new QuoteMessageBuilder(interaction, [], undefined),
      new EmoteMessageBuilder(interaction, [], undefined, true),
      new PingForPingListMessageBuilder(interaction, [], undefined)
    ];
    for (const builder of builders) expect(builder.markCurrentAsDeleted()).toBeUndefined();
  });

  test('custom IDs round-trip', () => {
    const id = getCustomId('previousButton', 'Emote', 7);
    expect(id).toBe('previousButton-Emote-7');
    expect(getBaseCustomIdFromCustomId(id)).toBe('previousButton');
    expect(getMessageBuilderTypeFromCustomId(id)).toBe('Emote');
    expect(getCounterFromCustomId(id)).toBe(7);
  });
});

test.each([
  '',
  'nextButton',
  'nextButton-Emote-',
  'nextButton-Emote-invalid',
  'nextButton-Emote-1.5',
  'nextButton-Emote-Infinity'
])('malformed component counters never select a builder: %s', (id) => {
  expect(getCounterFromCustomId(id)).toBeNaN();
});

test('missing or empty builder types do not select a registry', () => {
  expect(getMessageBuilderTypeFromCustomId('nextButton')).toBeUndefined();
  expect(getMessageBuilderTypeFromCustomId('nextButton--0')).toBeUndefined();
});
