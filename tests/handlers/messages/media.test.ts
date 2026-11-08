import type { Message, OmitPartialGroupDMChannel } from 'discord.js';
import { expect, type Mock, test, vi } from 'vitest';

import type { MediaDatabase } from 'src/database/media-database.ts';
import { type Guild, GUILD_ID_CUTEDOG } from 'src/discord/guild.ts';
import { mediaMessageCreateHandler } from 'src/handlers/messages/media.ts';

function target(
  content: string,
  member = true
): Readonly<{ value: OmitPartialGroupDMChannel<Message>; reply: Mock; react: Mock }> {
  const reply = vi.fn().mockResolvedValue(undefined);
  const react = vi.fn().mockResolvedValue(undefined);
  return {
    reply,
    react,
    value: {
      content,
      member: member ? { id: 'owner' } : null,
      reply,
      react
    } as unknown as OmitPartialGroupDMChannel<Message>
  };
}
const guild = { id: 'guild' } as Readonly<Guild>;

test.each([
  ['.name', false],
  ['.   ', true]
] as const)('ignores media requests without a member or name', async (content, member) => {
  const message = target(content, member);
  const lookup = vi.fn();
  await mediaMessageCreateHandler(message.value, guild, {
    getMediaUrl: lookup
  } as unknown as MediaDatabase);
  expect(lookup).not.toHaveBeenCalled();
  expect(message.reply).not.toHaveBeenCalled();
  expect(message.react).not.toHaveBeenCalled();
});

test.each([false, true])(
  'media names prefer exact matches, with legacy lowercase fallback: %s',
  async (legacy) => {
    const message = target('. Mixed ');
    const lookup = vi.fn().mockReturnValue('https://example.com/image.png');
    if (legacy) lookup.mockReturnValueOnce(undefined);
    await mediaMessageCreateHandler(message.value, guild, {
      getMediaUrl: lookup
    } as unknown as MediaDatabase);
    expect(lookup).toHaveBeenNthCalledWith(1, 'owner', 'Mixed');
    expect(lookup).toHaveBeenCalledTimes(legacy ? 2 : 1);
    if (legacy) expect(lookup).toHaveBeenNthCalledWith(2, 'owner', 'mixed');
    expect(message.reply).toHaveBeenCalledWith({
      content: 'https://example.com/image.png',
      allowedMentions: { repliedUser: false }
    });
  }
);

test.each(['guild', GUILD_ID_CUTEDOG])(
  'missing media uses the guild response for %s',
  async (id) => {
    const message = target('.missing');
    await mediaMessageCreateHandler(
      message.value,
      { id } as Readonly<Guild>,
      { getMediaUrl: vi.fn() } as unknown as MediaDatabase
    );
    expect(message.reply).not.toHaveBeenCalled();
    expect(message.react.mock.calls).toEqual(
      id === GUILD_ID_CUTEDOG ?
        [
          ['<:HAH1:1236635745570127892>'],
          ['<:HAH2:1236635747449045003>'],
          ['<:HAH3:1236635749290610740>']
        ]
      : [['❌']]
    );
  }
);

test('reply failures propagate to the event handler', async () => {
  const message = target('.name');
  message.reply.mockRejectedValue(new Error('Discord unavailable'));
  await expect(
    mediaMessageCreateHandler(message.value, guild, {
      getMediaUrl: vi.fn().mockReturnValue('https://example.com')
    } as unknown as MediaDatabase)
  ).rejects.toThrow('Discord unavailable');
});
