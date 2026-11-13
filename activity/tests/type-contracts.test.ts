import type { WritableKeys } from 'ts-essentials';
import { expectTypeOf, test } from 'vitest';

import type { ActivityOperation } from '../src/activity-api.ts';
import type { BrowserEmote } from '../src/catalog/catalog.ts';
import type { parseDiscoveryPage } from '../src/catalog/seventv.ts';
import type { EmoteSettings } from '../src/settings/emote-settings.ts';
import type { VoiceSettings } from '../src/settings/voice-settings.ts';

test('API routes require their own payload and forbid fields on reads', () => {
  expectTypeOf<
    ['emotes/batch', string, { action: 'add' | 'remove'; emoteIds: readonly string[] }]
  >().toExtend<ActivityOperation>();
  expectTypeOf<
    ['emotes/batch', string, { action: 'add'; remoteIds: string[] }]
  >().not.toExtend<ActivityOperation>();
  expectTypeOf<['settings/border', string, { color: string }]>().toExtend<ActivityOperation>();
  expectTypeOf<['settings/border', string]>().not.toExtend<ActivityOperation>();
  expectTypeOf<
    ['settings/border', string, { emoteId: string }]
  >().not.toExtend<ActivityOperation>();
  expectTypeOf<
    ['settings/border/read', string, { color: string }]
  >().not.toExtend<ActivityOperation>();
  expectTypeOf<
    ['emotes/batch', string, { action: 'invalid'; emoteIds: string[] }]
  >().not.toExtend<ActivityOperation>();
});

test('catalog snapshots are deeply readonly and discovery always supplies an ID', () => {
  expectTypeOf<WritableKeys<VoiceSettings>>().toEqualTypeOf<never>();
  expectTypeOf<EmoteSettings['allowedRoles']>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<BrowserEmote['tags']>().toEqualTypeOf<readonly string[] | undefined>();
  expectTypeOf<
    ReturnType<typeof parseDiscoveryPage>['emotes'][number]['sevenTVId']
  >().toEqualTypeOf<string>();
});
