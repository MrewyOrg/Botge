import type { Message, OmitPartialGroupDMChannel } from 'discord.js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { generateReply, scoreReplyOpportunity } from 'src/api/ollama/ollama.ts';
import { findSimilarWithContext } from 'src/api/ollama/vector-store.ts';
import { ollamaMessageCreateHandler } from 'src/handlers/messages/ollama.ts';

const { config } = vi.hoisted(() => ({
  config: {
    enabled: true,
    botName: 'Botge',
    activeChatChannels: [] as string[],
    behavior: {
      contextWindow: 3,
      cooldownSeconds: 0,
      evaluationChance: 1,
      replyScoreThreshold: 5,
      ragResults: 2,
      ragWindowSize: 1
    }
  }
}));
vi.mock('src/config/ollama-config.ts', () => ({ ollamaConfig: config }));
vi.mock('src/api/ollama/ollama.ts', () => ({
  generateReply: vi.fn(),
  scoreReplyOpportunity: vi.fn()
}));
vi.mock('src/api/ollama/vector-store.ts', () => ({
  storeMessage: vi.fn().mockResolvedValue(undefined),
  findSimilarWithContext: vi.fn()
}));
beforeEach(() => {
  vi.resetAllMocks();
  config.enabled = true;
  config.behavior.cooldownSeconds = 0;
  config.behavior.evaluationChance = 1;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.mocked(generateReply).mockResolvedValue('answer');
  vi.mocked(scoreReplyOpportunity).mockResolvedValue({
    shouldReply: true,
    score: 8,
    reason: 'context'
  });
  vi.mocked(findSimilarWithContext).mockResolvedValue(['previous context']);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test.each([
  'reply',
  'low-score',
  'no-reply',
  'score-error',
  'random',
  'cooldown',
  'rag-error',
  'empty',
  'send-error',
  'typing-error'
])('Ollama reply decisions handle %s', async (scenario) => {
  const id = 'decision-' + scenario;
  config.activeChatChannels = [id];
  const reply = vi
    .fn()
    .mockResolvedValue({ id: 'sent', channel: { id }, content: 'answer', createdAt: new Date() });
  const sendTyping = vi.fn().mockResolvedValue(undefined);
  const message = {
    id: 'input',
    author: { displayName: 'Author' },
    content: 'ordinary message',
    createdAt: new Date(),
    channel: { id, name: 'general', sendTyping },
    reply
  } as unknown as OmitPartialGroupDMChannel<Message>;
  if (scenario === 'low-score')
    vi.mocked(scoreReplyOpportunity).mockResolvedValue({
      shouldReply: true,
      score: 1,
      reason: 'low'
    });
  if (scenario === 'no-reply')
    vi.mocked(scoreReplyOpportunity).mockResolvedValue({
      shouldReply: false,
      score: 8,
      reason: 'skip'
    });
  if (scenario === 'score-error') vi.mocked(scoreReplyOpportunity).mockRejectedValue('offline');
  if (scenario === 'random') config.behavior.evaluationChance = 0;
  if (scenario === 'cooldown') {
    config.behavior.cooldownSeconds = 60;
    vi.spyOn(Date, 'now').mockReturnValue(1000);
  }
  if (scenario === 'rag-error')
    vi.mocked(findSimilarWithContext).mockRejectedValue(new Error('RAG offline'));
  if (scenario === 'empty') vi.mocked(generateReply).mockResolvedValue('');
  if (scenario === 'send-error') reply.mockRejectedValue(new Error('Discord offline'));
  if (scenario === 'typing-error') sendTyping.mockRejectedValue(new Error('Typing denied'));
  for (let index = 0; index < 3; index++) await ollamaMessageCreateHandler(message, 'bot');
  const skipped = ['low-score', 'no-reply', 'score-error', 'random', 'cooldown'].includes(scenario);
  expect(generateReply).toHaveBeenCalledTimes(skipped ? 0 : 1);
  expect(reply).toHaveBeenCalledTimes(skipped || scenario === 'empty' ? 0 : 1);
  if (scenario === 'rag-error') expect(generateReply).toHaveBeenCalledWith(expect.any(String), []);
});

test('disabled Ollama cannot handle messages', async () => {
  config.enabled = false;
  await expect(
    ollamaMessageCreateHandler({} as OmitPartialGroupDMChannel<Message>, 'bot')
  ).rejects.toThrow('not enabled');
});
test('messages outside configured channels are ignored', async () => {
  config.activeChatChannels = [];
  await ollamaMessageCreateHandler(
    { channel: { id: 'inactive' } } as OmitPartialGroupDMChannel<Message>,
    'bot'
  );
  expect(generateReply).not.toHaveBeenCalled();
});

function incoming(id: string): OmitPartialGroupDMChannel<Message> {
  const channel = { id, sendTyping: vi.fn().mockResolvedValue(undefined) };
  return {
    id: 'message',
    author: { displayName: 'Author' },
    content: '<@bot>',
    createdAt: new Date(),
    channel,
    reply: vi
      .fn()
      .mockResolvedValue({ id: 'sent', channel, content: 'answer', createdAt: new Date() })
  } as unknown as OmitPartialGroupDMChannel<Message>;
}

test('reply admission coalesces same-channel bursts and caps parallel model work', async () => {
  const generation = Promise.withResolvers<string>();
  const messages = ['parallel-a', 'parallel-b', 'parallel-c'].map(incoming);
  config.activeChatChannels = messages.map((message) => message.channel.id);
  for (const message of messages) {
    await ollamaMessageCreateHandler(message, 'bot');
    await ollamaMessageCreateHandler(message, 'bot');
  }
  vi.mocked(generateReply)
    .mockReturnValueOnce(generation.promise)
    .mockReturnValueOnce(generation.promise);
  const active = messages
    .slice(0, 2)
    .map(async (message) => ollamaMessageCreateHandler(message, 'bot'));
  try {
    await vi.waitFor(() => {
      expect(generateReply).toHaveBeenCalledTimes(2);
    });
    for (const message of messages) await ollamaMessageCreateHandler(message, 'bot');
    expect(generateReply).toHaveBeenCalledTimes(2);
  } finally {
    generation.resolve('answer');
    await Promise.all(active);
  }
  await ollamaMessageCreateHandler(messages[2] ?? incoming('parallel-c'), 'bot');
  expect(generateReply).toHaveBeenCalledTimes(3);
});

test('slow typing requests never overlap and their timer stops after generation', async () => {
  vi.useFakeTimers();
  const message = incoming('typing-backpressure');
  config.activeChatChannels = [message.channel.id];
  await ollamaMessageCreateHandler(message, 'bot');
  await ollamaMessageCreateHandler(message, 'bot');
  const generation = Promise.withResolvers<string>();
  const typing = Promise.withResolvers<undefined>();
  vi.mocked(generateReply).mockReturnValueOnce(generation.promise);
  const sendTyping = vi.spyOn(message.channel, 'sendTyping');
  sendTyping.mockResolvedValueOnce(undefined).mockReturnValueOnce(typing.promise);
  const pending = ollamaMessageCreateHandler(message, 'bot');
  try {
    await vi.advanceTimersByTimeAsync(24_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);
  } finally {
    typing.resolve(undefined);
    generation.resolve('answer');
    await pending;
  }
  expect(vi.getTimerCount()).toBe(0);
});
