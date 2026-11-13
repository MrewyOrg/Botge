/* Defines browser composition limits and the overlay grouping shared by preview operations. */

/** Maximum number of composition layers, including overlays; matches the Rust command limit. */
export const MAX_EMOTE_COMPOSE_INPUTS = 32;

/**
 * Groups ordered layers into base-and-overlay columns.
 *
 * @remarks
 * Each normal emote starts a column. Leading overlays form a column of their own.
 * The result preserves input order and reports each column's original starting index.
 *
 * @typeParam T - The layer representation.
 * @param items - Layers in composition order.
 * @param isOverlay - Identifies layers that belong to the preceding column.
 * @returns Column slices with their starting input indices; empty input produces no columns.
 *
 * @example
 * ```ts
 * groupEmoteLayers(['base', 'overlay', 'next'], item => item === 'overlay');
 * // [{ start: 0, layers: ['base', 'overlay'] }, { start: 2, layers: ['next'] }]
 * ```
 */
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

/**
 * Checks whether a name can occupy one token in the Discord compose input.
 *
 * @param value - Candidate name or token from catalog data.
 * @returns Whether it has more than one UTF-16 code unit and contains no whitespace.
 */
export function isComposeToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 1 && !/\s/u.test(value);
}
