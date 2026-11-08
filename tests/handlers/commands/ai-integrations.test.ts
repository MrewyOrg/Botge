import type { ChatInputCommandInteraction } from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import { chatGptHandler } from 'src/handlers/commands/chat-gpt.ts';
import { translateHandler } from 'src/handlers/commands/translate.ts';
import type { ReadonlyDeepLClient, ReadonlyOpenAI } from 'src/types.ts';

function target(
  values: Readonly<Record<string, string>> = {}
): Readonly<{ value: ChatInputCommandInteraction; reply: Mock; editReply: Mock }> {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  return {
    reply,
    editReply,
    value: {
      user: { id: 'owner' },
      reply,
      editReply,
      deferReply: vi.fn().mockResolvedValue(undefined),
      options: {
        get: (name: string): Readonly<{ value: string }> | null => {
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

test.each([chatGptHandler, translateHandler])(
  'disabled integrations respond without deferring',
  async (factory) => {
    const interaction = target();
    await factory(undefined)(interaction.value);
    expect(interaction.reply).toHaveBeenCalledOnce();
    expect(interaction.editReply).not.toHaveBeenCalled();
  }
);

test.each(['not a URL', 'https://example.com/a https://example.com/b'])(
  'invalid image input does not call OpenAI: %s',
  async (image) => {
    const interaction = target({ prompt: 'explain', image });
    const create = vi.fn();
    await chatGptHandler({ responses: { create } } as unknown as ReadonlyOpenAI)(interaction.value);
    expect(create).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledOnce();
  }
);

test.each([false, true])(
  'OpenAI replies stay within Discord limits, with image input: %s',
  async (image) => {
    const interaction = target({
      prompt: 'explain',
      ...(image ? { image: 'https://example.com/image.png' } : {})
    });
    const create = vi.fn().mockResolvedValue({ output_text: 'x'.repeat(2100) });
    await chatGptHandler({ responses: { create } } as unknown as ReadonlyOpenAI)(interaction.value);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        safety_identifier: 'owner',
        input:
          image ?
            [
              { role: 'user', content: 'explain' },
              {
                role: 'user',
                content: [
                  {
                    type: 'input_image',
                    image_url: 'https://example.com/image.png',
                    detail: 'auto'
                  }
                ]
              }
            ]
          : [{ role: 'user', content: 'explain' }]
      })
    );
    expect(interaction.editReply).toHaveBeenCalledWith('x'.repeat(1995) + ' ...');
  }
);

test('translation detects the source language and returns the translated text', async () => {
  const interaction = target({ text: 'bonjour' });
  const translateText = vi.fn().mockResolvedValue({ text: 'hello' });
  await translateHandler({ translateText } as unknown as ReadonlyDeepLClient)(interaction.value);
  expect(translateText).toHaveBeenCalledWith('bonjour', null, 'en-US', {
    modelType: 'prefer_quality_optimized',
    formality: 'default'
  });
  expect(interaction.editReply).toHaveBeenCalledWith('hello');
});

test('translation failures return feedback', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const interaction = target({ text: 'bonjour' });
  await translateHandler({
    translateText: vi.fn().mockRejectedValue(new Error('offline'))
  } as unknown as ReadonlyDeepLClient)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith('Failed to translate.');
});

test('invalid single image URLs are rejected without an API call', async () => {
  const interaction = target({ prompt: 'explain', image: 'invalid' });
  const create = vi.fn();
  await chatGptHandler({ responses: { create } } as unknown as ReadonlyOpenAI)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith('Please provide a valid link.');
  expect(create).not.toHaveBeenCalled();
});
test('OpenAI failures produce feedback', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const interaction = target({ prompt: 'explain', instruction: 'No instruction.' });
  await chatGptHandler({
    responses: { create: vi.fn().mockRejectedValue(new Error('offline')) }
  } as unknown as ReadonlyOpenAI)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith('Failed to ChatGPT.');
});
test('short OpenAI replies are preserved', async () => {
  const interaction = target({ prompt: 'explain' });
  await chatGptHandler({
    responses: { create: vi.fn().mockResolvedValue({ output_text: 'short reply' }) }
  } as unknown as ReadonlyOpenAI)(interaction.value);
  expect(interaction.editReply).toHaveBeenCalledWith('short reply');
});
