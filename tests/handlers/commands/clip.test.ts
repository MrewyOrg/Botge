import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import type { ClipIndex } from 'src/api/twitch/clip-index.ts';
import type { Guild } from 'src/discord/guild.ts';
import { clipHandler } from 'src/handlers/commands/clip.ts';
import type { TwitchClipMessageBuilder } from 'src/message-builders/twitch-clip-message-builder.ts';
import type { TwitchClip } from 'src/types.ts';

function target(
  values: Readonly<Record<string, string | boolean>> = {},
  direct = false
): Readonly<{
  value: ChatInputCommandInteraction;
  reply: Mock;
  editReply: Mock;
  deferReply: Mock;
}> {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferReply = vi.fn().mockResolvedValue(undefined);
  const value = {
    user: { id: 'owner' },
    guild: direct ? null : {},
    reply,
    editReply,
    deferReply,
    options: {
      get: (name: string): Readonly<{ value: string | boolean }> | null => {
        const option = values[name];
        return option === undefined ? null : { value: option };
      }
    }
  } as unknown as ChatInputCommandInteraction;
  return { value, reply, editReply, deferReply };
}

function index(
  hits: readonly TwitchClip[] = []
): Readonly<{ value: ClipIndex; search: Mock; getPagination: Mock }> {
  const search = vi.fn().mockResolvedValue({ hits: [...hits] });
  const getPagination = vi.fn().mockResolvedValue({ maxTotalHits: 100 });
  return { value: { search, getPagination } as unknown as ClipIndex, search, getPagination };
}

function guild(value: ClipIndex | undefined): Readonly<Guild> {
  return { twitchClipsMeilisearchIndex: value } as Readonly<Guild>;
}

function clip(id: string): TwitchClip {
  return {
    id,
    title: id,
    url: 'https://clips.twitch.tv/' + id,
    creator_name: 'Creator',
    game_id: '1',
    view_count: 10,
    created_at: '2026-11-07T12:34:56Z',
    thumbnail_url: 'https://example.com/image.jpg'
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('unavailable clip commands await the Discord response', async () => {
  const interaction = target();
  interaction.reply.mockRejectedValue(new Error('Discord unavailable'));
  await expect(clipHandler([])(interaction.value, guild(undefined))).rejects.toThrow(
    'Discord unavailable'
  );
});

test('ephemeral clips are rejected in direct messages', async () => {
  const interaction = target({ ephemeral: true }, true);
  await clipHandler([])(interaction.value, guild(undefined));
  expect(interaction.reply).toHaveBeenCalledWith({
    content: 'Ephemeral cannot be used in DMs.',
    flags: MessageFlags.Ephemeral
  });
});

test('creator and game filters quote and escape user values', async () => {
  const interaction = target({
    clipper: 'A "creator"',
    category: 'game "one"',
    title: 'TITLE',
    sortby: 'views'
  });
  const database = index();
  await clipHandler([])(interaction.value, guild(database.value));
  expect(database.search).toHaveBeenCalledWith('title', {
    filter: 'creator_name = "A \\"creator\\"" AND game_id = "game \\"one\\""',
    matchingStrategy: 'all',
    sort: ['view_count:desc'],
    limit: 100
  });
  expect(interaction.editReply).toHaveBeenCalledWith('Could not find clip.');
});

test('a single clip is sent directly', async () => {
  vi.stubEnv('EMBED_SERVER_TWITCH', '');
  const interaction = target();
  await clipHandler([])(interaction.value, guild(index([clip('one')]).value));
  expect(interaction.editReply).toHaveBeenCalledWith('https://clips.twitch.tv/one');
});

test('multiple shuffled clips register an interactive response', async () => {
  vi.stubEnv('EMBED_SERVER_TWITCH', '');
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const interaction = target({ sortby: 'shuffle', ephemeral: true });
  const database = index([clip('one'), clip('two')]);
  const builders: Readonly<TwitchClipMessageBuilder>[] = [];
  await clipHandler(builders)(interaction.value, guild(database.value));
  expect(builders).toHaveLength(1);
  expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  expect(interaction.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'https://clips.twitch.tv/two\n1/2' })
  );
  expect(database.search).toHaveBeenCalledWith(null, {
    filter: '',
    matchingStrategy: 'all',
    sort: [],
    limit: 100
  });
});

test('invalid index pagination reports a failed search', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const interaction = target();
  const database = index();
  database.getPagination.mockResolvedValue({ maxTotalHits: undefined });
  await clipHandler([])(interaction.value, guild(database.value));
  expect(database.search).not.toHaveBeenCalled();
  expect(interaction.editReply).toHaveBeenCalledWith('Failed to get clip.');
});

test.each(['https://embed.example.com', 'https://embed.example.com/'])(
  'single clips normalize the embed host: %s',
  async (host) => {
    vi.stubEnv('EMBED_SERVER_TWITCH', host);
    const interaction = target();
    await clipHandler([])(interaction.value, guild(index([clip('one')]).value));
    expect(interaction.editReply).toHaveBeenCalledWith('https://embed.example.com/one');
  }
);
