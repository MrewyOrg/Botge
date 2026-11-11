/**
 * A JSON-style object with string keys, excluding null and arrays.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Enforce an internal invariant without silently substituting a missing value. */
export function requireValue<T>(value: T, description: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(description);
  return value;
}
