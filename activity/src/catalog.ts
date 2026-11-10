import { isComposeToken } from './compose-layout.ts';
import { isRecord } from './validation.ts';

export type BrowserEmote = Readonly<{
  name: string;
  source: string;
  image: string;
  animated: boolean;
  added?: boolean;
  zeroWidth?: boolean;
  composeToken?: string;
  sevenTVId?: string;
}>;

function isMappedImage(path: string): boolean {
  if (!/^\/(?:7tv|bttv|ffz|twitch)-cdn\/[^\\]+$/u.test(path)) return false;
  const url = URL.parse(path, 'https://activity.invalid');
  return url !== null && url.pathname + url.search === path;
}

export function parseCatalog(input: unknown, server = false): readonly BrowserEmote[] {
  if (!Array.isArray(input)) throw new Error('Expected an emote catalog array.');
  return input.map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error('Expected an emote catalog entry.');
    const { name, source, image, animated, added, zeroWidth, composeToken } = entry;
    if (
      typeof name !== 'string'
      || name.trim() === ''
      || typeof source !== 'string'
      || source.trim() === ''
      || typeof image !== 'string'
      || !(server ?
        isMappedImage(image)
      : /^emotes\/(?:[\w-]+\/)*[\w-]+\.(?:png|webp|gif|jpe?g)$/iu.test(image))
      || typeof animated !== 'boolean'
      || (server && added !== undefined && typeof added !== 'boolean')
      || (zeroWidth !== undefined && typeof zeroWidth !== 'boolean')
      || (server
        && composeToken !== undefined
        && (!isComposeToken(composeToken) || composeToken !== name))
    )
      throw new Error('Invalid emote catalog entry.');

    const token = server ? composeToken : name.trim();
    return {
      name: name.trim(),
      source: source.trim(),
      image,
      animated,
      ...(server && typeof added === 'boolean' ? { added } : {}),
      ...(typeof zeroWidth === 'boolean' ? { zeroWidth } : {}),
      ...(isComposeToken(token) ? { composeToken: token } : {})
    };
  });
}

export function filterEmotes(
  emotes: readonly BrowserEmote[],
  query: string,
  source: string,
  motion: string,
  addedOnly = false
): readonly BrowserEmote[] {
  const search = query.trim().toLowerCase();
  return emotes.filter(
    (emote) =>
      emote.name.toLowerCase().includes(search)
      && (source === '' || emote.source === source)
      && (motion === '' || emote.animated === (motion === 'animated'))
      && (!addedOnly || emote.added === true)
  );
}
