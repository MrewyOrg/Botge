import { isComposeToken } from '../../emotes/rendering/compose-layout.ts';
import type { AssetInfo } from '../../types.ts';

const CDN_ORIGINS: ReadonlyMap<string, Readonly<{ prefix: string; source: string }>> = new Map([
  ['https://cdn.7tv.app', { prefix: '/7tv-cdn', source: '7TV' }],
  ['https://cdn.betterttv.net', { prefix: '/bttv-cdn', source: 'BTTV' }],
  ['https://cdn.frankerfacez.com', { prefix: '/ffz-cdn', source: 'FFZ' }],
  ['https://static-cdn.jtvnw.net', { prefix: '/twitch-cdn', source: 'Twitch' }]
]);

export type ActivityCatalogEmote = Readonly<{
  name: string;
  image: string;
  source: string;
  animated: boolean;
  added: boolean;
  zeroWidth: boolean;
  composeToken?: string;
}>;

export function activityCatalog(assets: readonly AssetInfo[]): readonly ActivityCatalogEmote[] {
  const names = new Set<string>();
  return assets.flatMap((asset) => {
    const composeToken =
      !names.has(asset.name) && isComposeToken(asset.name) ? asset.name : undefined;
    names.add(asset.name);
    const url = URL.parse(asset.url);
    if (url?.username !== '' || url.password !== '') return [];
    const cdn = CDN_ORIGINS.get(url.origin);
    if (cdn === undefined) return [];
    return [
      {
        name: asset.name,
        image: cdn.prefix + url.pathname + url.search,
        source: cdn.source,
        animated: asset.animated,
        added: asset.platform === 'sevenNotInSet',
        zeroWidth: asset.zeroWidth,
        ...(composeToken === undefined ? {} : { composeToken })
      }
    ];
  });
}
