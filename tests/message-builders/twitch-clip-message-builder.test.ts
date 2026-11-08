import type { ChatInputCommandInteraction } from 'discord.js';
import { afterEach, expect, test, vi } from 'vitest';

import { TwitchClipMessageBuilder } from 'src/message-builders/twitch-clip-message-builder.ts';
import type { TwitchClip } from 'src/types.ts';

const clips: readonly TwitchClip[] = ['Alpha', 'Bravo', 'Charlie'].map((title) => ({
  id: title,
  title,
  url: `https://clips.twitch.tv/${title}`,
  creator_name: 'Creator',
  game_id: '1',
  view_count: 10,
  created_at: '2026-11-07T12:34:56Z',
  thumbnail_url: 'https://example.com/thumbnail.jpg'
}));
function createBuilder(ephemeral = false): TwitchClipMessageBuilder {
  return new TwitchClipMessageBuilder(
    { user: { id: '123' } } as ChatInputCommandInteraction,
    clips,
    ephemeral
  );
}
afterEach(() => {
  vi.unstubAllEnvs();
});

test.each(['Bravo', 'bravo', 'rav'])('selects clip title %s independently', (title) => {
  vi.stubEnv('EMBED_SERVER_TWITCH', '');
  const builder = createBuilder();
  builder.first();
  expect(builder.jumpToIdentifier(title)?.content).toBe('https://clips.twitch.tv/Bravo\n2/3');
  expect(builder.jumpToIdentifier(title)).toBeUndefined();
});

test('uses the configured embed host and includes a send action for ephemeral clips', () => {
  vi.stubEnv('EMBED_SERVER_TWITCH', 'https://embed.example.com/');
  const builder = createBuilder(true);
  const page = builder.first();
  expect(page).toMatchObject({ content: 'https://embed.example.com/Alpha\n1/3' });
  expect(page?.components).toHaveLength(2);
  expect(builder.currentWithSentBy().content).toContain('Sent by: <@123>');
});

test('invalid identifiers leave the selected clip unchanged', () => {
  vi.stubEnv('EMBED_SERVER_TWITCH', '');
  const builder = createBuilder();
  builder.first();
  expect(builder.jumpToIdentifier('')).toBeUndefined();
  expect(builder.jumpToIdentifier('missing')).toBeUndefined();
  expect(builder.next()?.content).toBe('https://clips.twitch.tv/Bravo\n2/3');
});
