/**
 * A JSON-style object with string keys, excluding null and arrays.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate every element before exposing a typed, readonly array. */
export function isArrayOf<T>(
  value: unknown,
  predicate: (item: unknown) => item is T
): value is readonly T[] {
  return Array.isArray(value) && value.every(predicate);
}

/** Reject malformed external data before it enters a typed API. */
export function checked<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
  description: string
): T {
  if (!predicate(value)) throw new Error(`Invalid ${description} response.`);
  return value;
}

/** Enforce an internal invariant without silently substituting a missing value. */
export function requireValue<T>(value: T, description: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(description);
  return value;
}
