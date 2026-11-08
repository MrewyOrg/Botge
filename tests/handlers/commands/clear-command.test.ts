import {
  type ChatInputCommandInteraction,
  type Client,
  Collection,
  type ModalSubmitInteraction
} from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { clearHandler } from 'src/handlers/commands/clear.ts';

afterEach(() => vi.restoreAllMocks());

test.each([false, true])(
  'clear uses a bounded cursor and reports deletion failure: %s',
  async (fails) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const remove =
      fails ?
        vi.fn().mockRejectedValue(new Error('Forbidden'))
      : vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Collection([['100', { delete: remove }]]))
      .mockResolvedValueOnce(new Collection());
    const confirmation = {
      user: { id: 'owner' },
      customId: 'clearMessageModal:200',
      fields: { getTextInputValue: vi.fn().mockReturnValue('Yes') },
      deferred: true,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined)
    };
    const interaction = {
      id: '200',
      user: { id: 'owner' },
      channelId: 'channel',
      guild: {
        ownerId: 'owner',
        members: {
          fetch: vi.fn().mockResolvedValue({ user: { id: 'owner' } }),
          cache: new Map([['bot', {}]])
        }
      },
      showModal: vi.fn().mockResolvedValue(undefined),
      awaitModalSubmit: vi
        .fn()
        .mockImplementation(
          async (
            options: Readonly<{ filter: (value: ModalSubmitInteraction) => boolean }>
          ): Promise<unknown> => {
            expect(options.filter(confirmation as unknown as ModalSubmitInteraction)).toBe(true);
            expect(
              options.filter({
                ...confirmation,
                user: { id: 'another' }
              } as unknown as ModalSubmitInteraction)
            ).toBe(false);
            expect(
              options.filter({
                ...confirmation,
                customId: 'clearMessageModal:other'
              } as unknown as ModalSubmitInteraction)
            ).toBe(false);
            return await Promise.resolve(confirmation);
          }
        )
    };
    const client = {
      user: { id: 'bot' },
      channels: {
        cache: new Map([
          [
            'channel',
            {
              isTextBased: (): boolean => true,
              isDMBased: (): boolean => false,
              permissionsFor: (): Readonly<{ has: () => boolean }> => ({
                has: (): boolean => true
              }),
              messages: { fetch }
            }
          ]
        ])
      }
    };
    await clearHandler(client as unknown as Client)(
      interaction as unknown as ChatInputCommandInteraction
    );
    expect(fetch).toHaveBeenNthCalledWith(1, { limit: 100, before: '200' });
    expect(remove).toHaveBeenCalledOnce();
    if (fails) {
      expect(fetch).toHaveBeenCalledOnce();
      expect(confirmation.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear')
      );
    } else {
      expect(fetch).toHaveBeenNthCalledWith(2, { limit: 100, before: '100' });
      expect(confirmation.editReply).toHaveBeenCalledWith('Cleared messages.');
    }
  }
);
