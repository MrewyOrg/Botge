import { setTimeout } from 'node:timers/promises';

import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { beforeEach, expect, type Mock, test, vi } from 'vitest';

import { transientHandler } from 'src/handlers/commands/transient.ts';

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));
function target(
  text?: string,
  attachment?: string,
  duration?: number
): Readonly<{ value: ChatInputCommandInteraction; reply: Mock; deleteReply: Mock }> {
  const reply = vi.fn().mockResolvedValue(undefined);
  const deleteReply = vi.fn().mockResolvedValue(undefined);
  const options = new Map([
    ['text', { value: text }],
    ['duration', { value: duration }],
    ['attachment', { attachment: attachment === undefined ? undefined : { url: attachment } }]
  ]);
  return {
    reply,
    deleteReply,
    value: {
      reply,
      deleteReply,
      options: { get: (name: string): unknown => options.get(name) }
    } as unknown as ChatInputCommandInteraction
  };
}
beforeEach(() => {
  vi.clearAllMocks();
});
test.each([
  [undefined, undefined],
  ['text', 'https://example.com/a.png']
] as const)('requires exactly one content input: %s %s', async (text, attachment) => {
  const interaction = target(text, attachment);
  await transientHandler()(interaction.value);
  expect(interaction.reply).toHaveBeenCalledWith({
    content:
      text === undefined ?
        'Please provide either attachment or text.'
      : 'Please only provide either attachment or text.',
    flags: MessageFlags.Ephemeral
  });
  expect(interaction.deleteReply).not.toHaveBeenCalled();
});
test.each([-1, 601, NaN, Infinity])('rejects invalid duration %s', async (duration) => {
  const interaction = target('text', undefined, duration);
  await transientHandler()(interaction.value);
  expect(interaction.reply).toHaveBeenCalledWith({
    content: 'Please provide a duration between 0 and 600.',
    flags: MessageFlags.Ephemeral
  });
  expect(setTimeout).not.toHaveBeenCalled();
});
test.each([false, true])(
  'deletes text or attachment only after its duration: %s',
  async (attachment) => {
    const interaction = target(
      attachment ? undefined : 'hello',
      attachment ? 'https://example.com/a.png' : undefined,
      2
    );
    const timer = Promise.withResolvers<undefined>();
    vi.mocked(setTimeout).mockReturnValueOnce(timer.promise);
    const pending = transientHandler()(interaction.value);
    await Promise.resolve();
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    timer.resolve(undefined);
    await pending;
    expect(setTimeout).toHaveBeenCalledWith(2000);
    expect(interaction.reply).toHaveBeenCalledWith(
      attachment ? 'https://example.com/a.png' : 'hello'
    );
    expect(interaction.deleteReply).toHaveBeenCalledOnce();
  }
);
