import { type APIEmbedField, type ChatInputCommandInteraction, Collection } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { MediaMessageBuilder } from 'src/message-builders/media-message-builder.ts';
import { PingForPingListMessageBuilder } from 'src/message-builders/ping-for-ping-list-message-builder.ts';
import {
  getContent,
  type PingForPingMeMessageBuilder
} from 'src/message-builders/ping-for-ping-me-message-builder.ts';
import { QuoteMessageBuilder } from 'src/message-builders/quote-message-builder.ts';
import { TwitchClipMessageBuilder } from 'src/message-builders/twitch-clip-message-builder.ts';
import type { Ping, TwitchClip } from 'src/types.ts';
import { requireValue } from 'src/utils/validation.ts';

const interaction = { user: { id: 'reader' } } as ChatInputCommandInteraction;
const clip: TwitchClip = {
  id: 'clip-id',
  url: 'https://clips.twitch.tv/clip-id',
  title: 'Clip',
  creator_name: 'Creator',
  game_id: '1',
  view_count: 1,
  created_at: '2026-01-01T00:00:00Z',
  thumbnail_url: 'https://example.com/thumb.png'
};
const ping: Ping = {
  time: Date.parse('2026-03-29T00:30:00Z'),
  days: null,
  hours: null,
  minutes: null,
  userId: 'owner',
  channelId: 'channel',
  message: null,
  userIds: null,
  userIdRemoved: null
};

afterEach(() => {
  vi.unstubAllEnvs();
});

test('long quote content is preserved across valid embed fields', () => {
  const content = 'x'.repeat(2000);
  const builder = new QuoteMessageBuilder(
    interaction,
    [{ name: 'Quote', content, dateAdded: new Date(0) }],
    undefined
  );
  const embed = requireValue(builder.first()?.embeds[0], 'Expected indexed test value.').toJSON();
  expect(embed).toBeDefined();
  const fields =
    embed.fields?.filter((field: Readonly<APIEmbedField>) => field.name.startsWith('Content'))
    ?? [];
  expect(fields.map((field: Readonly<APIEmbedField>) => field.value).join('')).toBe(content);
  expect(fields.every((field: Readonly<APIEmbedField>) => field.value.length <= 1024)).toBe(true);
});

test.each([undefined, ''])(
  'clip URLs fall back to Twitch without an embed server (%s)',
  (server) => {
    vi.stubEnv('EMBED_SERVER_TWITCH', server);
    const builder = new TwitchClipMessageBuilder(interaction, [clip], false);
    expect(builder.first()?.content).toBe(`${clip.url}\n1/1`);
    expect(builder.currentWithSentBy().content).toBe(`${clip.url}\nSent by: <@reader>`);
  }
);

test.each(['https://example.com/t/', 'https://example.com/t'])(
  'clip URLs support a configured embed server (%s)',
  (server) => {
    vi.stubEnv('EMBED_SERVER_TWITCH', server);
    const builder = new TwitchClipMessageBuilder(interaction, [clip], true);
    const reply = builder.first();
    expect(reply?.content).toBe('https://example.com/t/clip-id\n1/1');
    expect(reply?.components).toHaveLength(2);
  }
);

test('reminder duration separates days, hours, and minutes', () => {
  expect(getContent({ ...ping, days: 1, hours: 2, minutes: 3 }, 'PingRegistered')).toBe(
    'The ping has been registered for 1 day, 2 hours, and 3 minutes.'
  );
});

test.each([
  ['+02:00', '02:30:00 UTC+02:00'],
  ['-03:30', '21:00:00 UTC-03:30']
])('reminder timezone %s is independent of host DST', (offset, expectedTime) => {
  vi.stubEnv('TZ', 'Europe/Budapest');
  const view = {
    ping: { ...ping, message: 'x'.repeat(1800) }
  } as unknown as Readonly<PingForPingMeMessageBuilder>;
  const builder = new PingForPingListMessageBuilder(interaction, [view], offset);
  const embed = requireValue(builder.first()?.embeds[0], 'Expected indexed test value.').toJSON();
  expect(embed.title).toContain(expectedTime);
  const fields =
    embed.fields?.filter((field: Readonly<APIEmbedField>) => field.name.startsWith('Message'))
    ?? [];
  expect(fields.map((field: Readonly<APIEmbedField>) => field.value).join('')).toBe(
    view.ping.message
  );
  expect(fields.every((field: Readonly<APIEmbedField>) => field.value.length <= 1024)).toBe(true);
});

test('empty quote text renders a placeholder field', () => {
  const builder = new QuoteMessageBuilder(
    interaction,
    [{ name: 'Empty', content: '', dateAdded: new Date(0) }],
    undefined
  );
  expect(builder.first()?.embeds[0]?.toJSON().fields).toContainEqual({
    name: 'Content',
    value: '-'
  });
});

test('Tenor previews and repeated media deletions retain the displayed state', () => {
  const builder = new MediaMessageBuilder(
    interaction,
    [
      { name: 'First', url: 'https://example.com/first', dateAdded: new Date(0) },
      {
        name: 'Second',
        url: 'https://tenor.com/view/name-123',
        tenorUrl: 'https://example.com/preview.gif',
        dateAdded: new Date(0)
      }
    ],
    undefined
  );
  builder.first();
  expect(builder.jumpToIdentifier('Second')?.embeds[0]?.toJSON().thumbnail?.url).toBe(
    'https://example.com/preview.gif'
  );
  expect(builder.markCurrentAsDeleted()).toBeDefined();
  expect(builder.markCurrentAsDeleted()).toBeUndefined();
  expect(builder.currentMedia).toBeUndefined();
});

test.each(['bad', '+24:00', '+00:60'])(
  'invalid reminder timezone offsets fail clearly: %s',
  (offset) => {
    const builder = new PingForPingListMessageBuilder(
      interaction,
      [{ ping } as Readonly<PingForPingMeMessageBuilder>],
      offset
    );
    expect(() => builder.first()).toThrow('Invalid timezone offset.');
  }
);

test('reminder lists show recipients and mark deleted pages once', () => {
  const member = { id: 'known', displayName: 'LongName'.repeat(150) };
  const source = {
    guild: {
      members: { cache: new Collection([['known', member]]) },
      channels: { cache: new Collection() }
    }
  } as unknown as ChatInputCommandInteraction;
  const view = {
    ping: { ...ping, userIds: ['known', 'missing'], message: 'message' }
  } as unknown as Readonly<PingForPingMeMessageBuilder>;
  const builder = new PingForPingListMessageBuilder(source, [view], undefined);
  expect(builder.first()).toBeDefined();
  expect(builder.currentPingForPingMeMessageBuilder).toBe(view);
  expect(builder.markCurrentAsDeleted()?.embeds[0]?.toJSON().description).toContain('DELETED');
  expect(builder.markCurrentAsDeleted()).toBeUndefined();
  expect(builder.currentPingForPingMeMessageBuilder).toBeUndefined();
});
