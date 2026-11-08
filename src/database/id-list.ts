/**
 * Preserve the existing comma-separated representation of Discord IDs.
 */

export function serializeIds(ids: readonly string[] | null): string | null {
  return ids !== null && ids.length > 0 ? ids.join(',') : null;
}

export function deserializeIds(ids: string | null): readonly string[] | null {
  return ids !== null && ids !== '' ? ids.split(',') : null;
}
