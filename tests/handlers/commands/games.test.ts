import { type ChatInputCommandInteraction, Collection } from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import { requestResponse } from 'src/api/http.ts';
import type { Guild } from 'src/discord/guild.ts';
import { findTheEmojiHandler } from 'src/handlers/commands/find-the-emoji.ts';
import { steamHandler } from 'src/handlers/commands/steam.ts';

vi.mock('src/api/http.ts', () => ({ requestResponse: vi.fn() }));
function target(
  values: Readonly<Record<string, string | number>> = {},
  direct = false,
  count = 2
): Readonly<{ value: ChatInputCommandInteraction; editReply: Mock }> {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const emojis = new Collection(
    Array.from(
      { length: count },
      (_, index) => [String(index), { name: 'emoji' + String(index), animated: false }] as const
    )
  );
  const guild = {
    fetch: vi.fn().mockResolvedValue({ emojis: { fetch: vi.fn().mockResolvedValue(emojis) } })
  };
  return {
    editReply,
    value: {
      guild: direct ? null : guild,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply,
      options: {
        get: (name: string): Readonly<{ value: string | number }> | null => {
          const value = values[name];
          return value === undefined ? null : { value };
        }
      }
    } as unknown as ChatInputCommandInteraction
  };
}
afterEach(() => {
  vi.restoreAllMocks();
});

test.each([
  [2, 'Size must be at least 3.'],
  [8, 'Size must be at most 7.'],
  [3.5, 'Size must be a whole number.']
] as const)('emoji grid rejects size %s', async (size, message) => {
  const interaction = target({ size });
  await findTheEmojiHandler()(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith(message);
});
test.each([3, 4, 5, 6, 7])('emoji grids have %s rows and exactly one target', async (size) => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const interaction = target({ size, emoji: '<:emoji0:0>' });
  await findTheEmojiHandler()(interaction.value);
  const content: unknown = interaction.editReply.mock.calls[0]?.[0];
  expect(typeof content).toBe('string');
  if (typeof content !== 'string') throw new Error('Expected grid text.');
  expect(content.match(/\|\|<:emoji0:0>\|\|/gu)).toHaveLength(1);
  expect(content.match(/\|\|<:emoji1:1>\|\|/gu)).toHaveLength(size * size - 1);
});
test.each([
  [true, 2, 'The bot must be in a server for this command to work.'],
  [false, 1, 'Must have at least 2 non-animated emojis in the server.']
] as const)(
  'emoji grids require a server with enough emojis: %s %s',
  async (direct, count, message) => {
    const interaction = target({}, direct, count);
    await findTheEmojiHandler()(interaction.value);
    expect(interaction.editReply).toHaveBeenCalledWith(message);
  }
);
test('foreign emojis cannot be selected', async () => {
  const interaction = target({ emoji: '<:foreign:99>' });
  await findTheEmojiHandler()(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith('Emoji must be from this server.');
});

test.each([
  [10, 'Overwhelmingly Negative'],
  [30, 'Mostly Negative'],
  [50, 'Mixed'],
  [75, 'Mostly Positive'],
  [90, 'Very Positive'],
  [99, 'Overwhelmingly Positive']
] as const)('Steam summaries label %s percent reviews', async (percent, label) => {
  vi.mocked(requestResponse).mockImplementation(async (url) =>
    Promise.resolve(
      new Response(
        url.includes('GetNumber') ?
          JSON.stringify({ response: { player_count: 12345 } })
        : `${percent}% of the 1,234 user reviews in the last 30 days are positive. ${percent}% of the 9,876 user reviews for this game are positive.`
      )
    )
  );
  const interaction = target();
  await steamHandler('123')(interaction.value, { id: 'guild' } as Readonly<Guild>);
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining(label));
  expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('12,345'));
});
test.each([true, false])(
  'Steam rejects invalid player data or missing review markup: %s',
  async (badPlayers) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(requestResponse).mockImplementation(async (url) =>
      Promise.resolve(
        new Response(
          url.includes('GetNumber') ?
            JSON.stringify(badPlayers ? {} : { response: { player_count: 1 } })
          : 'no reviews'
        )
      )
    );
    const interaction = target();
    await steamHandler('123')(interaction.value, { id: 'guild' } as Readonly<Guild>);
    expect(interaction.editReply).toHaveBeenCalledWith('something went wrong.');
  }
);
