import { expect, test } from 'vitest';

import { DEMO_GUILD_ID, resolveFeatures } from '../src/features.ts';

const guildId = '300000000000000003' as const;
const allFlags = {
  VITE_ENABLE_ACTIVITY_ADDS: 'true',
  VITE_ENABLE_ACTIVITY_CATALOG: 'true',
  VITE_ENABLE_ACTIVITY_SETTINGS: 'true',
  VITE_ENABLE_ACTIVITY_GAME: 'true',
  VITE_ENABLE_7TV_DISCOVERY: 'true'
} as const;

test('enables nothing without flags', () => {
  expect(resolveFeatures({}, { embedded: true, guildId })).toEqual({
    demo: false,
    guildId,
    catalogGuildId: undefined,
    settingsGuildId: undefined,
    gameGuildId: undefined,
    adds: false,
    discovery: false
  });
});

test('follows each flag inside Discord and ignores the demo flag there', () => {
  expect(
    resolveFeatures({ ...allFlags, VITE_ENABLE_ACTIVITY_DEMO: 'true' }, { embedded: true, guildId })
  ).toEqual({
    demo: false,
    guildId,
    catalogGuildId: guildId,
    settingsGuildId: guildId,
    gameGuildId: guildId,
    adds: true,
    discovery: true
  });
});

test('turns on every feature against the demo guild outside Discord', () => {
  expect(
    resolveFeatures({ VITE_ENABLE_ACTIVITY_DEMO: 'true' }, { embedded: false, guildId: undefined })
  ).toEqual({
    demo: true,
    guildId: DEMO_GUILD_ID,
    catalogGuildId: DEMO_GUILD_ID,
    settingsGuildId: DEMO_GUILD_ID,
    gameGuildId: DEMO_GUILD_ID,
    adds: true,
    discovery: true
  });
});
