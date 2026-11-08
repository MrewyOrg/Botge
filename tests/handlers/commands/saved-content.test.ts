import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';

import type { MediaDatabase } from 'src/database/media-database.ts';
import type { QuotesDatabase } from 'src/database/quotes-database.ts';
import { GUILD_ID_CUTEDOG } from 'src/discord/guild.ts';
import { mediaListHandler } from 'src/handlers/commands/media-list.ts';
import { mediaHandler } from 'src/handlers/commands/media.ts';
import { quoteListHandler } from 'src/handlers/commands/quote-list.ts';
import { quoteHandler } from 'src/handlers/commands/quote.ts';
import type { MediaMessageBuilder } from 'src/message-builders/media-message-builder.ts';
import type { QuoteMessageBuilder } from 'src/message-builders/quote-message-builder.ts';
import type { Media, Quote } from 'src/types.ts';

function target(
  name = 'Mixed',
  guildId = 'guild'
): Readonly<{ value: ChatInputCommandInteraction; reply: Mock; editReply: Mock }> {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      user: { id: 'owner' },
      guildId,
      reply,
      editReply,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: {
        get: (key: string): Readonly<{ value: string }> => ({
          value: key === 'name' ? name : 'alphabetical'
        })
      }
    } as unknown as ChatInputCommandInteraction,
    reply,
    editReply
  };
}

afterEach(() => vi.restoreAllMocks());

describe.each(['media', 'quote'] as const)('%s lookup', (kind) => {
  function handler(
    lookup: (userId: string, name: string) => string | undefined
  ): (interaction: ChatInputCommandInteraction) => Promise<void> {
    return kind === 'media' ?
        mediaHandler({ getMediaUrl: lookup } as unknown as MediaDatabase)
      : quoteHandler({ getQuoteContent: lookup } as unknown as QuotesDatabase);
  }

  test('exact names take priority over the legacy lowercase fallback', async () => {
    const lookup = vi.fn().mockReturnValue('saved content');
    const interaction = target();
    await handler(lookup)(interaction.value);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('owner', 'Mixed');
    expect(interaction.reply).toHaveBeenCalledWith('saved content');
  });

  test('legacy lowercase names remain accessible', async () => {
    const lookup = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce('legacy content');
    const interaction = target();
    await handler(lookup)(interaction.value);
    expect(lookup).toHaveBeenNthCalledWith(2, 'owner', 'mixed');
    expect(interaction.reply).toHaveBeenCalledWith('legacy content');
  });

  test.each(['guild', GUILD_ID_CUTEDOG])(
    'missing content responds privately in %s',
    async (guildId) => {
      const interaction = target('missing', guildId);
      await handler(vi.fn())(interaction.value);
      expect(interaction.reply).toHaveBeenCalledWith({
        content:
          guildId === GUILD_ID_CUTEDOG ? 'jij'
          : kind === 'media' ? 'Media not found.'
          : 'Quote not found.',
        flags: MessageFlags.Ephemeral
      });
    }
  );

  test('database errors produce a private failure response', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const interaction = target();
    await handler(
      vi.fn(() => {
        throw new Error('database unavailable');
      })
    )(interaction.value);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Something went wrong. Please try again later.',
      flags: MessageFlags.Ephemeral
    });
  });
});

test.each(['media', 'quote'] as const)('empty %s lists do not register a builder', async (kind) => {
  const interaction = target();
  const read = vi.fn().mockReturnValue([]);
  if (kind === 'media') {
    const builders: Readonly<MediaMessageBuilder>[] = [];
    await mediaListHandler(
      { getAllMedia: read } as unknown as MediaDatabase,
      builders
    )(interaction.value);
    expect(builders).toEqual([]);
    expect(interaction.editReply).toHaveBeenCalledWith('You do not have any media added.');
  } else {
    const builders: Readonly<QuoteMessageBuilder>[] = [];
    await quoteListHandler(
      { getAllQuote: read } as unknown as QuotesDatabase,
      builders
    )(interaction.value);
    expect(builders).toEqual([]);
    expect(interaction.editReply).toHaveBeenCalledWith('You do not have any quote added.');
  }
  expect(read).toHaveBeenCalledExactlyOnceWith('owner');
});

test('quote lists sort a copy and register a working response', async () => {
  const records: readonly Quote[] = [
    { name: 'Zulu', content: 'last', dateAdded: new Date('2030-01-01') },
    { name: 'Alpha', content: 'first', dateAdded: new Date('2030-01-01') }
  ];
  const builders: Readonly<QuoteMessageBuilder>[] = [];
  const interaction = target();
  await quoteListHandler(
    { getAllQuote: vi.fn().mockReturnValue(records) } as unknown as QuotesDatabase,
    builders
  )(interaction.value);
  expect(records.map((record) => record.name)).toEqual(['Zulu', 'Alpha']);
  expect(builders).toHaveLength(1);
  expect(interaction.editReply).toHaveBeenCalled();
  expect(builders[0]?.next()).toBeDefined();
});

test('media lists sort without changing database results', async () => {
  const records: readonly Media[] = ['Zulu', 'Alpha'].map((name) => ({
    name,
    url: 'https://example.com/' + name,
    dateAdded: new Date('2030-01-01')
  }));
  const builders: Readonly<MediaMessageBuilder>[] = [];
  const interaction = target();
  await mediaListHandler(
    { getAllMedia: vi.fn().mockReturnValue(records) } as unknown as MediaDatabase,
    builders
  )(interaction.value);
  expect(records.map((record) => record.name)).toEqual(['Zulu', 'Alpha']);
  expect(builders).toHaveLength(1);
  expect(builders[0]?.next()?.embeds[0]?.data.title).toBe('Zulu');
  expect(builders[0]?.previous()?.embeds[0]?.data.title).toBe('Alpha');
});

test.each(['media', 'quote'] as const)(
  '%s list database errors produce a failure response without registering a builder',
  async (kind) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const read = vi.fn(() => {
      throw new Error('database unavailable');
    });
    const interaction = target();
    if (kind === 'media') {
      const builders: Readonly<MediaMessageBuilder>[] = [];
      await mediaListHandler(
        { getAllMedia: read } as unknown as MediaDatabase,
        builders
      )(interaction.value);
      expect(builders).toEqual([]);
      expect(interaction.editReply).toHaveBeenCalledWith('Failed to show media list.');
    } else {
      const builders: Readonly<QuoteMessageBuilder>[] = [];
      await quoteListHandler(
        { getAllQuote: read } as unknown as QuotesDatabase,
        builders
      )(interaction.value);
      expect(builders).toEqual([]);
      expect(interaction.editReply).toHaveBeenCalledWith('Failed to show quote list.');
    }
  }
);
