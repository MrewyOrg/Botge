import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction
} from 'discord.js';
import { afterEach, expect, type Mock, test, vi } from 'vitest';

import type { ApiManager } from 'src/bot/api-manager.ts';
import type { DatabaseManager } from 'src/bot/database-manager.ts';
import { MessageBuilderManager } from 'src/bot/message-builder-manager.ts';
import type { Guild } from 'src/discord/guild.ts';
import { buttonHandler } from 'src/handlers/interactions/button.ts';
import { modalSubmitHandler } from 'src/handlers/interactions/modal-submit.ts';
import {
  FIRST_BUTTON_BASE_CUSTOM_ID,
  getCustomId,
  JUMP_TO_BUTTON_BASE_CUSTOM_ID,
  JUMP_TO_MODAL_BASE_CUSTOM_ID,
  LAST_BUTTON_BASE_CUSTOM_ID,
  NEXT_BUTTON_BASE_CUSTOM_ID,
  PREVIOUS_BUTTON_BASE_CUSTOM_ID
} from 'src/message-builders/base.ts';
import {
  DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID,
  MediaMessageBuilder,
  RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID
} from 'src/message-builders/media-message-builder.ts';
import {
  DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID,
  QuoteMessageBuilder,
  RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID
} from 'src/message-builders/quote-message-builder.ts';
import {
  SEND_CLIP_BUTTON_BASE_CUSTOM_ID,
  TwitchClipMessageBuilder
} from 'src/message-builders/twitch-clip-message-builder.ts';
import type { Media, Quote } from 'src/types.ts';

function interaction(
  customId = '',
  owner = 'owner'
): Readonly<{
  value: ButtonInteraction;
  editReply: Mock;
  deferUpdate: Mock;
  showModal: Mock;
  modalReply: Mock;
  awaitModalSubmit: Mock;
  fields: Readonly<{ getTextInputValue: Mock }>;
}> {
  const editReply = vi.fn().mockResolvedValue(undefined);
  const deferUpdate = vi.fn().mockResolvedValue(undefined);
  const showModal = vi.fn().mockResolvedValue(undefined);
  const modalReply = vi.fn().mockResolvedValue(undefined);
  const fields = { getTextInputValue: vi.fn().mockReturnValue('renamed') };
  const awaitModalSubmit = vi
    .fn()
    .mockResolvedValue({ user: { id: owner }, fields, reply: modalReply });
  return {
    editReply,
    deferUpdate,
    showModal,
    modalReply,
    awaitModalSubmit,
    fields,
    value: {
      customId,
      user: { id: owner },
      editReply,
      deferUpdate,
      showModal,
      awaitModalSubmit,
      fields
    } as unknown as ButtonInteraction
  };
}
function setup(
  kind: string
): Readonly<{
  original: ReturnType<typeof interaction>;
  manager: MessageBuilderManager;
  builder: MediaMessageBuilder | QuoteMessageBuilder | TwitchClipMessageBuilder;
  store: Readonly<{ delete: Mock; rename: Mock; mediaNameExists: Mock; quoteNameExists: Mock }>;
  handle: ReturnType<typeof buttonHandler>;
  database: Readonly<DatabaseManager>;
  guild: Readonly<Guild>;
}> {
  const original = interaction();
  const manager = new MessageBuilderManager();
  const records: readonly (Media & Quote)[] = ['Alpha', 'Bravo', 'Charlie'].map((name) => ({
    name,
    content: name,
    url: 'https://example.com/' + name,
    dateAdded: new Date('2030-01-01')
  }));
  const source = original.value as unknown as ChatInputCommandInteraction;
  const builder =
    kind === 'Media' ? new MediaMessageBuilder(source, records, undefined)
    : kind === 'Quote' ? new QuoteMessageBuilder(source, records, undefined)
    : new TwitchClipMessageBuilder(
        source,
        records.map((record) => ({
          id: record.name,
          title: record.name,
          url: record.url,
          creator_name: 'creator',
          game_id: '1',
          view_count: 1,
          created_at: '2030-01-01',
          thumbnail_url: record.url
        })),
        true
      );
  if (builder instanceof MediaMessageBuilder) manager.mediaMessageBuilders.push(builder);
  else if (builder instanceof QuoteMessageBuilder) manager.quoteMessageBuilders.push(builder);
  else manager.twitchClipMessageBuilders.push(builder);
  builder.first();
  const store = {
    delete: vi.fn(),
    rename: vi.fn(),
    mediaNameExists: vi.fn().mockReturnValue(false),
    quoteNameExists: vi.fn().mockReturnValue(false)
  };
  const database = {
    mediaDatabase: store,
    quoteDatabase: store
  } as unknown as Readonly<DatabaseManager>;
  const guild = { id: 'guild' } as Readonly<Guild>;
  const handle = buttonHandler({} as Client, guild, undefined, manager, database);
  return { original, manager, builder, store, handle, database, guild };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each(['Media', 'Quote', 'Clip'])(
  'navigation changes only the owning %s response',
  async (kind) => {
    const target = setup(kind);
    for (const action of [
      NEXT_BUTTON_BASE_CUSTOM_ID,
      LAST_BUTTON_BASE_CUSTOM_ID,
      PREVIOUS_BUTTON_BASE_CUSTOM_ID,
      FIRST_BUTTON_BASE_CUSTOM_ID
    ]) {
      const event = interaction(getCustomId(action, kind, target.builder.counter));
      await target.handle(event.value);
      expect(event.deferUpdate).toHaveBeenCalledOnce();
    }
    expect(target.original.editReply).toHaveBeenCalledTimes(4);
    const foreign = interaction(
      getCustomId(NEXT_BUTTON_BASE_CUSTOM_ID, kind, target.builder.counter),
      'other'
    );
    await target.handle(foreign.value);
    expect(target.original.editReply).toHaveBeenCalledTimes(4);
    const jump = interaction(
      getCustomId(JUMP_TO_BUTTON_BASE_CUSTOM_ID, kind, target.builder.counter)
    );
    await target.handle(jump.value);
    expect(jump.showModal).toHaveBeenCalledOnce();
  }
);

test.each(['Media', 'Quote'])(
  'deletion removes the selected %s and updates its displayed state',
  async (kind) => {
    const target = setup(kind);
    const id =
      kind === 'Media' ? DELETE_MEDIA_BUTTON_BASE_CUSTOM_ID : DELETE_QUOTE_BUTTON_BASE_CUSTOM_ID;
    await target.handle(interaction(getCustomId(id, kind, target.builder.counter)).value);
    expect(target.store.delete).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ name: 'Alpha' })
    );
    expect(target.original.editReply).toHaveBeenCalledOnce();
  }
);

test.each(['Media', 'Quote'])(
  'renaming %s persists the current content under its new name',
  async (kind) => {
    const target = setup(kind);
    const event = interaction(
      getCustomId(
        kind === 'Media' ? RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID : RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID,
        kind,
        target.builder.counter
      )
    );
    await target.handle(event.value);
    expect(target.store.rename).toHaveBeenCalledWith(
      'owner',
      kind === 'Media' ? 'https://example.com/Alpha' : 'Alpha',
      'renamed'
    );
    expect(event.modalReply).toHaveBeenCalledOnce();
  }
);

test.each(['Media', 'Quote'])(
  'duplicate %s names and timed-out rename modals do not write',
  async (kind) => {
    const target = setup(kind);
    target.store.mediaNameExists.mockReturnValue(true);
    target.store.quoteNameExists.mockReturnValue(true);
    const id = getCustomId(
      kind === 'Media' ? RENAME_MEDIA_BUTTON_BASE_CUSTOM_ID : RENAME_QUOTE_BUTTON_BASE_CUSTOM_ID,
      kind,
      target.builder.counter
    );
    const duplicate = interaction(id);
    await target.handle(duplicate.value);
    expect(duplicate.modalReply).toHaveBeenCalledOnce();
    expect(target.store.rename).not.toHaveBeenCalled();
    const timeout = interaction(id);
    timeout.awaitModalSubmit.mockRejectedValue(new Error('timeout'));
    await target.handle(timeout.value);
    expect(target.store.rename).not.toHaveBeenCalled();
  }
);

test.each(['2', '', 'invalid', '1'])('jump modals handle page input %j', async (page) => {
  const target = setup('Media');
  vi.spyOn(Math, 'random').mockReturnValue(0.8);
  const event = interaction(
    getCustomId(JUMP_TO_MODAL_BASE_CUSTOM_ID, 'Media', target.builder.counter)
  );
  event.fields.getTextInputValue.mockImplementation((name: string) => {
    if (name.startsWith('jumpToIdentifier')) throw new Error('Absent optional field');
    return page;
  });
  await modalSubmitHandler(
    [],
    [],
    target.guild,
    target.manager,
    target.database,
    {} as ApiManager
  )(event.value as unknown as ModalSubmitInteraction);
  expect(event.deferUpdate).toHaveBeenCalledOnce();
  expect(target.original.editReply).toHaveBeenCalledTimes(
    page === 'invalid' || page === '1' ? 0 : 1
  );
});

test.each([true, false])(
  'sending clips checks the bot permissions rather than the requesting user: %s',
  async (allowed) => {
    vi.stubEnv('EMBED_SERVER_TWITCH', '');
    const target = setup('Clip');
    const send = vi.fn().mockResolvedValue(undefined);
    const botMember = { id: 'bot' };
    const permissionsFor = vi.fn().mockReturnValue({ has: (): boolean => allowed });
    const client = {
      user: { id: 'bot' },
      channels: {
        cache: new Map([
          [
            'channel',
            {
              send,
              permissionsFor,
              isTextBased: (): boolean => true,
              isDMBased: (): boolean => false
            }
          ]
        ])
      }
    } as unknown as Client;
    const event = interaction(
      getCustomId(SEND_CLIP_BUTTON_BASE_CUSTOM_ID, 'Clip', target.builder.counter)
    );
    Object.assign(event.value, {
      channelId: 'channel',
      guild: { members: { cache: new Map([['bot', botMember]]) } }
    });
    await buttonHandler(
      client,
      target.guild,
      undefined,
      target.manager,
      target.database
    )(event.value);
    expect(permissionsFor).toHaveBeenCalledWith(botMember);
    expect(send).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(event.deferUpdate).toHaveBeenCalledOnce();
  }
);

test.each(['Media', 'Clip'])(
  'identifier jump modals navigate %s and reject conflicting inputs',
  async (kind) => {
    const target = setup(kind);
    for (const page of ['', '2']) {
      const event = interaction(
        getCustomId(JUMP_TO_MODAL_BASE_CUSTOM_ID, kind, target.builder.counter)
      );
      event.fields.getTextInputValue.mockImplementation((name: string) =>
        name.startsWith('jumpToIdentifier') ? 'Bravo' : page
      );
      await modalSubmitHandler(
        [],
        [],
        target.guild,
        target.manager,
        target.database,
        {} as ApiManager
      )(event.value as unknown as ModalSubmitInteraction);
    }
    expect(target.original.editReply).toHaveBeenCalledOnce();
  }
);

test.each([
  'unsupported',
  getCustomId(NEXT_BUTTON_BASE_CUSTOM_ID, 'Unknown', 0),
  getCustomId(NEXT_BUTTON_BASE_CUSTOM_ID, 'Media', -1)
])('stale buttons are acknowledged without editing another response: %s', async (id) => {
  const target = setup('Media');
  const event = interaction(id);
  await target.handle(event.value);
  expect(event.deferUpdate).toHaveBeenCalledOnce();
  expect(target.original.editReply).not.toHaveBeenCalled();
});
