/**
 * Narrows an unknown value to an object with string-keyed properties.
 *
 * @remarks
 * This checks only the outer shape. Callers must validate each property they consume.
 *
 * @param value - Untrusted input.
 * @returns Whether the value is a non-null object other than an array.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Enforces an internal invariant without substituting a missing value.
 *
 * @typeParam T - The value's original type.
 * @param value - A required value, such as a queried DOM element.
 * @param description - Error text identifying the missing invariant.
 * @returns The original value narrowed to exclude null and undefined.
 * @throws `Error` if the value is null or undefined.
 */
export function requireValue<T>(value: T, description: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(description);
  return value;
}
