import { expect, test } from 'vitest';

import { parseCatalog } from '../../src/catalog/catalog.ts';
import { createDemoServer } from '../../src/demo/demo-server.ts';
import { DEMO_GUILD_ID } from '../../src/features.ts';
import { isRecord } from '../../src/validation.ts';

function emotes(payload: unknown): readonly unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload['emotes'])) throw new Error('Not a catalog.');
  return payload['emotes'];
}

test('serves a catalog that passes server catalog validation', async () => {
  const demo = createDemoServer(0);
  const payload = await demo.request('catalog', DEMO_GUILD_ID);
  expect(payload).toMatchObject({ canManageEmotes: true, canComposeDiscovery: true });
  const catalog = parseCatalog(emotes(payload), true);
  expect(catalog.filter((emote) => emote.added === true).map((emote) => emote.name)).toEqual([
    'Wave',
    'Hype',
    'Halo'
  ]);
  expect(new Set(catalog.map((emote) => emote.source))).toEqual(
    new Set(['7TV', 'BTTV', 'FFZ', 'Twitch'])
  );
});

test('rejects operations for other guilds with an API-style message', async () => {
  const demo = createDemoServer(0);
  expect(await demo.request('catalog', '200000000000000002')).toEqual({
    message: 'Open the demo server to try this.'
  });
});

test('adds, refuses duplicates, and removes saved 7TV emotes', async () => {
  const demo = createDemoServer(0);
  const page = await demo.discover('top', 1, 'Think', '', '', '');
  const think = page.emotes[0]?.sevenTVId ?? '';
  expect(await demo.request('emotes', DEMO_GUILD_ID, { emoteId: think })).toEqual({
    message: 'Added Think to this server.',
    added: true
  });
  expect(await demo.request('emotes', DEMO_GUILD_ID, { emoteId: think })).toEqual({
    message: 'Think is already on this server.'
  });
  expect(await demo.request('emotes', DEMO_GUILD_ID, { emoteId: 'x'.repeat(26) })).toEqual({
    message: 'That 7TV emote was not found.'
  });
  expect(
    parseCatalog(emotes(await demo.request('catalog', DEMO_GUILD_ID)), true).some(
      (emote) => emote.sevenTVId === think && emote.added === true
    )
  ).toBe(true);
  expect(await demo.request('emotes/remove', DEMO_GUILD_ID, { emoteId: think })).toEqual({
    message: 'Removed Think from this server.',
    removed: true
  });
  expect(await demo.request('emotes/remove', DEMO_GUILD_ID, { emoteId: think })).toEqual({
    message: 'That emote is not saved on this server.'
  });
});

test('reports each item of a batch change', async () => {
  const demo = createDemoServer(0);
  const page = await demo.discover('top', 1, '', '', '', '');
  const [wave, grin] = page.emotes.map((emote) => emote.sevenTVId);
  expect(
    await demo.request('emotes/batch', DEMO_GUILD_ID, {
      action: 'add',
      emoteIds: [wave ?? '', grin ?? '']
    })
  ).toEqual([
    { emoteId: wave, ok: false, message: 'Wave is already on this server.' },
    { emoteId: grin, ok: true, message: 'Added Grin to this server.' }
  ]);
  expect(
    await demo.request('emotes/batch', DEMO_GUILD_ID, { action: 'remove', emoteIds: [grin ?? ''] })
  ).toEqual([{ emoteId: grin, ok: true, message: 'Removed Grin from this server.' }]);
});

test('keeps voice, emote, and border settings in memory', async () => {
  const demo = createDemoServer(0);
  expect(await demo.request('settings', DEMO_GUILD_ID)).toMatchObject({
    voice: { channelId: '100000000000000011', statusEnabled: true, statusEmoji: 'Wave' }
  });
  const voice = { channelId: null, statusEnabled: false, statusEmoji: null } as const;
  expect(await demo.request('settings/voice', DEMO_GUILD_ID, { voice })).toMatchObject({ voice });
  expect(await demo.request('settings', DEMO_GUILD_ID)).toMatchObject({ voice });

  const read = await demo.request('settings/emotes/read', DEMO_GUILD_ID);
  expect(read).toMatchObject({ allowEveryone: false, allowedRoles: ['100000000000000021'] });
  const emoteSettings = {
    sevenTvSet: null,
    bttvTwitchId: null,
    ffzChannel: 'other',
    allowEveryone: true,
    allowedRoles: []
  } as const;
  expect(
    await demo.request('settings/emotes', DEMO_GUILD_ID, { emotes: emoteSettings })
  ).toMatchObject(emoteSettings);

  expect(await demo.request('settings/border/read', DEMO_GUILD_ID)).toEqual({ color: 'f0b232' });
  expect(await demo.request('settings/border', DEMO_GUILD_ID, { color: '#AB12CD' })).toEqual({
    color: 'ab12cd'
  });
  expect(await demo.request('settings/border', DEMO_GUILD_ID, { color: '' })).toEqual({
    color: ''
  });
});

test('pages and filters placeholder discovery results', async () => {
  const demo = createDemoServer(0);
  const top = await demo.discover('top', 1, '', '', '', '');
  const trending = await demo.discover('trending', 1, '', '', '', '');
  expect(top.pageCount).toBe(3);
  expect(top.emotes).toHaveLength(24);
  expect(trending.emotes[1]?.name).not.toBe(top.emotes[1]?.name);
  expect((await demo.discover('top', 3, '', '', '', '')).emotes).toHaveLength(16);

  const overlays = await demo.discover('top', 1, '', 'animated', 'overlaying', '');
  expect(overlays.emotes.map((emote) => emote.name)).toEqual([
    'Sparkles',
    'SparklesFast',
    'SparklesBig',
    'SparklesTiny'
  ]);
  const tagged = await demo.discover('top', 1, 'hat', 'static', 'overlaying', 'celebrate, overlay');
  expect(tagged.emotes.map((emote) => emote.name)).toEqual(['Hat', 'HatFast', 'HatBig', 'HatTiny']);
  expect((await demo.discover('top', 1, 'nothing', '', 'regular', '')).pageCount).toBe(0);
});
