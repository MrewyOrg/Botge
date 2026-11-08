import type { Message, OmitPartialGroupDMChannel } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { generateReply } from 'src/api/ollama/ollama.ts';
import { storeMessage } from 'src/api/ollama/vector-store.ts';
import { ollamaMessageCreateHandler } from 'src/handlers/messages/ollama.ts';

vi.mock('src/config/ollama-config.ts', () => ({
  ollamaConfig: {
    enabled: true,
    botName: 'Botge',
    activeChatChannels: ['failure', 'success'],
    behavior: {
      contextWindow: 3,
      cooldownSeconds: 0,
      evaluationChance: 0,
      ragResults: 0,
      ragWindowSize: 0
    }
  }
}));
vi.mock('src/api/ollama/ollama.ts', () => ({
  generateReply: vi.fn(),
  scoreReplyOpportunity: vi.fn()
}));
vi.mock('src/api/ollama/vector-store.ts', () => ({
  storeMessage: vi.fn(),
  findSimilarWithContext: vi.fn().mockResolvedValue([])
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

test.each(['failure', 'success'])(
  'reply generation cleans up typing and safely persists output: %s',
  async (channelId) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const typing = Promise.withResolvers<undefined>();
    const sendTyping = vi.fn().mockReturnValue(typing.promise);
    const sentMessage = {
      id: 'actual-discord-id',
      content: 'x'.repeat(2000),
      channel: { id: channelId },
      createdAt: new Date()
    };
    const reply = vi.fn().mockResolvedValue(sentMessage);
    const message = {
      id: 'incoming',
      content: '<@bot>',
      author: { displayName: 'User' },
      channel: { id: channelId, sendTyping },
      createdAt: new Date(),
      reply
    } as unknown as OmitPartialGroupDMChannel<Message>;
    vi.mocked(storeMessage).mockRejectedValue(new Error('Storage unavailable'));
    if (channelId === 'failure')
      vi.mocked(generateReply).mockRejectedValue(new Error('Generation failed'));
    else vi.mocked(generateReply).mockResolvedValue('x'.repeat(2100));
    await ollamaMessageCreateHandler(message, 'bot');
    await ollamaMessageCreateHandler(message, 'bot');
    const pending = ollamaMessageCreateHandler(message, 'bot');
    if (channelId === 'failure') {
      await pending;
      typing.resolve(undefined);
      await Promise.resolve();
      expect(reply).not.toHaveBeenCalled();
    } else {
      typing.resolve(undefined);
      await pending;
      expect(reply).toHaveBeenCalledWith('x'.repeat(2000));
      expect(storeMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'actual-discord-id', content: 'x'.repeat(2000) })
      );
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(errorLog).toHaveBeenCalled();
  }
);
