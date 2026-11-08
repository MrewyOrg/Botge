import type { AssetInfo, BotgeConfig } from '../types.ts';

export type EmoteProviderSettings = Pick<
  BotgeConfig['general'],
  | 'use7TVAddedEmotes'
  | 'use7TVGlobalEmotes'
  | 'use7TVPersonalEmotes'
  | 'useBTTVEmotes'
  | 'useFFZEmotes'
  | 'useTwitchEmotes'
>;

/** Catalog entries retain their source, so each 7TV switch applies independently. */
export function isEmoteEnabled(
  asset: Pick<AssetInfo, 'platform' | 'isSevenTVPersonal'>,
  settings: EmoteProviderSettings
): boolean {
  const enabled: Readonly<Record<AssetInfo['platform'], boolean>> = {
    sevenInSet:
      asset.isSevenTVPersonal ? settings.use7TVPersonalEmotes : settings.use7TVGlobalEmotes,
    sevenNotInSet: settings.use7TVAddedEmotes,
    bttv: settings.useBTTVEmotes,
    ffz: settings.useFFZEmotes,
    twitch: settings.useTwitchEmotes
  };
  return enabled[asset.platform];
}

/** Direct 7TV URLs are standalone emotes, governed by the added-emote switch. */
export function isEmoteUrlEnabled(url: string, settings: EmoteProviderSettings): boolean {
  const parsed = URL.parse(url);
  if (parsed === null) return true;
  const { hostname, pathname } = parsed;
  const belongsTo = (domain: string): boolean =>
    hostname === domain || hostname.endsWith(`.${domain}`);
  if (belongsTo('7tv.app') || belongsTo('7tv.io')) return settings.use7TVAddedEmotes;
  if (belongsTo('betterttv.com') || belongsTo('betterttv.net')) return settings.useBTTVEmotes;
  if (belongsTo('frankerfacez.com')) return settings.useFFZEmotes;
  if (hostname === 'static-cdn.jtvnw.net' && pathname.startsWith('/emoticons/'))
    return settings.useTwitchEmotes;
  return true;
}
