import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { expect, test, vi } from 'vitest';

import { clearHandler } from 'src/handlers/commands/clear.ts';

test.each([
  'dm',
  'member',
  'channel',
  'ViewChannel',
  'SendMessages',
  'ManageMessages',
  'ReadMessageHistory',
  'decline',
  'timeout'
])('clear refuses unsafe or unconfirmed requests: %s', async (reason) => {
  const reply = vi.fn().mockResolvedValue(undefined);
  const showModal = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn();
  const confirmationReply = vi.fn().mockResolvedValue(undefined);
  const interaction = {
    id: 'request',
    user: { id: 'owner' },
    channelId: 'channel',
    reply,
    showModal,
    guild:
      reason === 'dm' ? null : (
        {
          ownerId: 'owner',
          members: {
            fetch: vi
              .fn()
              .mockResolvedValue({ user: { id: reason === 'member' ? 'other' : 'owner' } }),
            cache: new Map([['bot', {}]])
          }
        }
      ),
    awaitModalSubmit:
      reason === 'timeout' ?
        vi.fn().mockRejectedValue(new Error('timeout'))
      : vi
          .fn()
          .mockResolvedValue({
            fields: { getTextInputValue: (): string => 'No' },
            reply: confirmationReply
          })
  } as unknown as ChatInputCommandInteraction;
  const client = {
    user: { id: 'bot' },
    channels: {
      cache: new Map(
        reason === 'channel' ?
          []
        : [
            [
              'channel',
              {
                isTextBased: (): boolean => true,
                isDMBased: (): boolean => false,
                permissionsFor: (): Readonly<{ has: (permission: string) => boolean }> => ({
                  has: (permission: string): boolean => permission !== reason
                }),
                messages: { fetch: remove }
              }
            ]
          ]
      )
    }
  } as unknown as Client;
  await clearHandler(client)(interaction);
  expect(remove).not.toHaveBeenCalled();
  expect(showModal).toHaveBeenCalledTimes(reason === 'decline' || reason === 'timeout' ? 1 : 0);
  if (reason === 'decline') expect(confirmationReply).toHaveBeenCalledOnce();
  else if (reason !== 'timeout') expect(reply).toHaveBeenCalledOnce();
});
