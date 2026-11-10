export const MAX_EMOTE_COMPOSE_INPUTS = 32;

/** Each normal emote starts a column; zero-width emotes layer over the current column. */
export function groupEmoteLayers<T>(
  items: readonly T[],
  isOverlay: (item: T) => boolean
): readonly Readonly<{ start: number; layers: readonly T[] }>[] {
  const groups: { start: number; layers: readonly T[] }[] = [];
  let start = 0;
  for (const [index, item] of items.entries()) {
    if (index > start && !isOverlay(item)) {
      groups.push({ start, layers: items.slice(start, index) });
      start = index;
    }
  }
  if (items.length > 0) groups.push({ start, layers: items.slice(start) });
  return groups;
}

export function isComposeToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 1 && !/\s/u.test(value);
}
