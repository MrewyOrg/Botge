/* Resolves which guild features the page enables from build flags and the launch context. */

/** The pretend guild every demo operation targets. */
export const DEMO_GUILD_ID = '100000000000000001' as const;

/** Enabled features. A guild ID is `undefined` when its feature is off or no guild is known. */
export type ActivityFeatures = Readonly<{
  /** Whether the in-memory demo replaces the Botge API and 7TV discovery. */
  demo: boolean;
  /** The guild that server changes target. */
  guildId: string | undefined;
  /** The guild whose server catalog replaces the local preview catalog. */
  catalogGuildId: string | undefined;
  /** The guild whose settings panels are shown. */
  settingsGuildId: string | undefined;
  /** Whether 7TV emotes may be added to the guild. */
  adds: boolean;
  /** Whether the Trending and Top 7TV modes are shown. */
  discovery: boolean;
}>;

/**
 * Combines the `VITE_ENABLE_*` build flags with where the page was opened.
 *
 * @remarks
 * Outside Discord, `VITE_ENABLE_ACTIVITY_DEMO` turns on every feature against the demo guild. Inside
 * Discord the demo flag is ignored and each feature follows its own flag.
 *
 * @param flags - Build-time environment, such as `import.meta.env`.
 * @param launch - Whether the page runs inside Discord, and the guild it was launched from.
 * @returns The enabled features and their target guilds.
 */
export function resolveFeatures(
  flags: Readonly<Record<string, unknown>>,
  launch: Readonly<{ embedded: boolean; guildId: string | undefined }>
): ActivityFeatures {
  const on = (name: string): boolean => flags[name] === 'true';
  const demo = !launch.embedded && on('VITE_ENABLE_ACTIVITY_DEMO');
  const guildId = demo ? DEMO_GUILD_ID : launch.guildId;
  return {
    demo,
    guildId,
    catalogGuildId: demo || on('VITE_ENABLE_ACTIVITY_CATALOG') ? guildId : undefined,
    settingsGuildId: demo || on('VITE_ENABLE_ACTIVITY_SETTINGS') ? guildId : undefined,
    adds: demo || on('VITE_ENABLE_ACTIVITY_ADDS'),
    discovery: demo || on('VITE_ENABLE_7TV_DISCOVERY')
  };
}
