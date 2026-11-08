import type { Message, OmitPartialGroupDMChannel } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import type { CachedUrl } from 'src/api/cached-url.ts';
import type { MediaDatabase } from 'src/database/media-database.ts';
import type { Guild } from 'src/discord/guild.ts';
import { mediaMessageCreateHandler } from 'src/handlers/messages/media.ts';
import { messageCreateHandler } from 'src/handlers/messages/message-create.ts';
import { ollamaMessageCreateHandler } from 'src/handlers/messages/ollama.ts';

vi.mock('src/config/ollama-config.ts', () => ({ ollamaConfig: { enabled: true } }));
vi.mock('src/handlers/messages/ollama.ts', () => ({ ollamaMessageCreateHandler: vi.fn() }));
vi.mock('src/handlers/messages/media.ts', () => ({
  MEDIA_COMMAND_IDENTIFIER: '.',
  mediaMessageCreateHandler: vi.fn()
}));
vi.mock('src/handlers/commands/emote.ts', () => ({
  EMOTE_COMMAND_IDENTIFIER: '!',
  emotesHandler: (): ReturnType<typeof vi.fn> => vi.fn()
}));
afterEach(() => {
  vi.clearAllMocks();
});

test('a space after an unrelated first character does not suppress AI message routing', async () => {
  const message = { content: 'a normal message' } as OmitPartialGroupDMChannel<Message>;
  await messageCreateHandler('bot')(
    {} as Readonly<CachedUrl>,
    message,
    {} as Readonly<Guild>,
    [],
    {} as Readonly<MediaDatabase>
  );
  expect(ollamaMessageCreateHandler).toHaveBeenCalledWith(message, 'bot');
});

test('media messages dispatch to the media handler', async () => {
  const message = { content: '.saved' } as OmitPartialGroupDMChannel<Message>;
  const guild = {} as Readonly<Guild>;
  const database = {} as Readonly<MediaDatabase>;
  await messageCreateHandler('bot')({} as Readonly<CachedUrl>, message, guild, [], database);
  expect(mediaMessageCreateHandler).toHaveBeenCalledWith(message, guild, database);
});

test('a spaced emote prefix is ignored and null client IDs skip AI routing', async () => {
  for (const content of ['! spaced', 'normal message']) {
    await messageCreateHandler(null)(
      {} as CachedUrl,
      { content } as OmitPartialGroupDMChannel<Message>,
      {} as Guild,
      [],
      {} as MediaDatabase
    );
  }
  expect(ollamaMessageCreateHandler).not.toHaveBeenCalled();
});
test('failed media handlers are caught at the message boundary', async () => {
  const error = new Error('failed media');
  vi.mocked(mediaMessageCreateHandler).mockRejectedValueOnce(error);
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await messageCreateHandler(null)(
      {} as CachedUrl,
      { content: '.saved' } as OmitPartialGroupDMChannel<Message>,
      {} as Guild,
      [],
      {} as MediaDatabase
    );
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
