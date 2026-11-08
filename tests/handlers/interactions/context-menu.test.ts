import {
  Collection,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction
} from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import type { ApiManager } from 'src/bot/api-manager.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { CONTEXT_MENU_COMMAND_NAMES as names } from 'src/discord/command-names.ts';
import { messageContextMenuCommandHandler } from 'src/handlers/interactions/message-context-menu-command.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

type TestContext = Readonly<{
  interaction: MessageContextMenuCommandInteraction;
  handle: ReturnType<typeof messageContextMenuCommandHandler>;
  store: Readonly<
    Record<
      | 'mediaUrlExists'
      | 'mediaNameExists'
      | 'quoteContentExists'
      | 'quoteNameExists'
      | 'getMediaName'
      | 'getQuoteName'
      | 'insert'
      | 'delete',
      Mock
    >
  >;
  reply: Mock;
  editReply: Mock;
  showModal: Mock;
  awaitModalSubmit: Mock;
  modalReply: Mock;
}>;

function setup(
  commandName: string,
  urls: readonly (string | null)[] = ['https://tenor.com/view/test-123'],
  api: Readonly<ApiManager> = {} as ApiManager
): TestContext {
  const reply = vi.fn().mockResolvedValue(undefined);
  const editReply = vi.fn().mockResolvedValue(undefined);
  const showModal = vi.fn().mockResolvedValue(undefined);
  const modalReply = vi.fn().mockResolvedValue(undefined);
  const awaitModalSubmit = vi
    .fn()
    .mockResolvedValue({ fields: { getTextInputValue: (): string => 'saved' }, reply: modalReply });
  const store = {
    mediaUrlExists: vi.fn().mockReturnValue(false),
    mediaNameExists: vi.fn().mockReturnValue(false),
    quoteContentExists: vi.fn().mockReturnValue(false),
    quoteNameExists: vi.fn().mockReturnValue(false),
    getMediaName: vi.fn().mockReturnValue('saved'),
    getQuoteName: vi.fn().mockReturnValue('saved'),
    insert: vi.fn(),
    delete: vi.fn()
  };
  const interaction = {
    commandName,
    user: { id: 'owner' },
    targetMessage: {
      content: 'quoted text',
      embeds: urls.map((url) => ({ url })),
      attachments: new Collection()
    },
    reply,
    editReply,
    showModal,
    awaitModalSubmit,
    deferReply: vi.fn().mockResolvedValue(undefined)
  } as unknown as MessageContextMenuCommandInteraction;
  const handle = messageContextMenuCommandHandler(
    { mediaDatabase: store, quoteDatabase: store } as unknown as DatabaseManager,
    api
  );
  return { interaction, handle, store, reply, editReply, showModal, awaitModalSubmit, modalReply };
}

test.each([names.addMedia, names.addQuote])(
  '%s saves content for the acting user after naming',
  async (command) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-01-01T00:00:00Z'));
    const target = setup(command);
    await target.handle(target.interaction);
    expect(target.showModal).toHaveBeenCalledOnce();
    expect(target.store.insert).toHaveBeenCalledWith(
      'owner',
      command === names.addMedia ?
        {
          name: 'saved',
          url: 'https://tenor.com/view/test-123',
          dateAdded: new Date('2030-01-01T00:00:00Z')
        }
      : { name: 'saved', content: 'quoted text', dateAdded: new Date('2030-01-01T00:00:00Z') }
    );
    expect(target.modalReply).toHaveBeenCalledWith({
      content:
        command === names.addMedia ?
          'Added media with the name saved.'
        : 'Added quote with the name saved.',
      flags: MessageFlags.Ephemeral
    });
  }
);

test.each([names.addMedia, names.addQuote])(
  '%s rejects a duplicate name after the modal',
  async (command) => {
    const target = setup(command);
    target.store.mediaNameExists.mockReturnValue(true);
    target.store.quoteNameExists.mockReturnValue(true);
    await target.handle(target.interaction);
    expect(target.store.insert).not.toHaveBeenCalled();
    expect(target.modalReply).toHaveBeenCalledWith({
      content:
        command === names.addMedia ?
          'There already is a media added with this name.'
        : 'There already is a quote added with this name.',
      flags: MessageFlags.Ephemeral
    });
  }
);

test.each([names.addMedia, names.addQuote])(
  '%s rejects duplicate content before showing a modal',
  async (command) => {
    const target = setup(command);
    target.store.mediaUrlExists.mockReturnValue(true);
    target.store.quoteContentExists.mockReturnValue(true);
    await target.handle(target.interaction);
    expect(target.showModal).not.toHaveBeenCalled();
    expect(target.store.insert).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledOnce();
  }
);

test.each([names.removeMedia, names.removeQuote])(
  '%s deletes only the acting user’s selected content',
  async (command) => {
    const target = setup(command);
    await target.handle(target.interaction);
    expect(target.store.delete).toHaveBeenCalledWith(
      'owner',
      command === names.removeMedia ?
        { name: 'saved', url: 'https://tenor.com/view/test-123' }
      : { name: 'saved', content: 'quoted text' }
    );
    expect(target.modalReply).toHaveBeenCalledOnce();
  }
);

test.each([names.addMedia, names.addQuote, names.removeMedia, names.removeQuote])(
  '%s modal timeout does not modify storage',
  async (command) => {
    const target = setup(command);
    target.awaitModalSubmit.mockRejectedValue(new Error('timeout'));
    await target.handle(target.interaction);
    expect(target.store.insert).not.toHaveBeenCalled();
    expect(target.store.delete).not.toHaveBeenCalled();
    expect(target.modalReply).not.toHaveBeenCalled();
  }
);

test.each([names.removeMedia, names.removeQuote])(
  '%s reports missing saved content',
  async (command) => {
    const target = setup(command);
    target.store.getMediaName.mockReturnValue(undefined);
    target.store.getQuoteName.mockReturnValue(undefined);
    await target.handle(target.interaction);
    expect(target.showModal).not.toHaveBeenCalled();
    expect(target.store.delete).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledOnce();
  }
);

test.each([{ urls: [] }, { urls: ['https://example.com/unsupported.png'] }])(
  'unsupported media gives feedback without opening a modal: %j',
  async ({ urls }: Readonly<{ urls: readonly string[] }>) => {
    const target = setup(names.addMedia, urls);
    await target.handle(target.interaction);
    expect(target.showModal).not.toHaveBeenCalled();
    expect(target.store.insert).not.toHaveBeenCalled();
    expect(target.reply).toHaveBeenCalledOnce();
  }
);

test.each([names.chatGptExplain, names.translate])(
  'unavailable %s integrations respond after deferring',
  async (command) => {
    const target = setup(command);
    await target.handle(target.interaction);
    expect(target.editReply).toHaveBeenCalledWith(
      command === names.translate ?
        'Translate is not available right now.'
      : 'ChatGPT command is not available right now.'
    );
  }
);

test.each(['text', 'image'])(
  'explanations include %s context and respect Discord message limits',
  async (kind) => {
    const create = vi.fn().mockResolvedValue({ output_text: 'x'.repeat(2100) });
    const target = setup(
      names.chatGptExplain,
      kind === 'image' ? ['https://example.com/image.png'] : [],
      { openai: { responses: { create } } } as unknown as ApiManager
    );
    await target.handle(target.interaction);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ safety_identifier: 'owner' }));
    expect(target.editReply).toHaveBeenCalledWith('x'.repeat(1995) + ' ...');
  }
);

test('context translation returns translated text', async () => {
  const translateText = vi.fn().mockResolvedValue({ text: 'translated' });
  const target = setup(names.translate, [], {
    deepLClient: { translateText }
  } as unknown as ApiManager);
  await target.handle(target.interaction);
  expect(translateText).toHaveBeenCalledWith('quoted text', null, 'en-US', {
    modelType: 'prefer_quality_optimized',
    formality: 'default'
  });
  expect(target.editReply).toHaveBeenCalledWith('translated');
});

test('media with a missing embed URL is rejected before naming', async () => {
  const target = setup(names.addMedia, [null]);
  await target.handle(target.interaction);
  expect(target.reply).toHaveBeenCalledWith({
    content: "Target message's url is empty.",
    flags: MessageFlags.Ephemeral
  });
});

test.each([names.addMedia, names.removeMedia, names.addQuote, names.removeQuote])(
  '%s modal collectors accept only the matching modal ID',
  async (command) => {
    const target = setup(command);
    target.awaitModalSubmit.mockImplementation(
      async (options: Readonly<{ filter: (interaction: ModalSubmitInteraction) => boolean }>) => {
        const modal: unknown = target.showModal.mock.calls[0]?.[0];
        if (!(modal instanceof ModalBuilder)) throw new Error('Expected a modal.');
        expect(
          options.filter({ customId: modal.toJSON().custom_id } as ModalSubmitInteraction)
        ).toBe(true);
        expect(options.filter({ customId: 'unrelated-modal' } as ModalSubmitInteraction)).toBe(
          false
        );
        return Promise.reject(new Error('timeout'));
      }
    );
    await target.handle(target.interaction);
    expect(target.awaitModalSubmit).toHaveBeenCalledOnce();
    expect(target.store.insert).not.toHaveBeenCalled();
    expect(target.store.delete).not.toHaveBeenCalled();
  }
);
