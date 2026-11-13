/* Accepts the two supported 7TV ID formats before building links or compose tokens. */

/**
 * Accepts a legacy 24-digit hexadecimal ID or a 26-character alphanumeric ID.
 *
 * @param value - Untrusted provider ID.
 * @returns Whether the value can be used in 7TV links and compose tokens.
 */
export function isSevenTVEmoteId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{24}|[a-z0-9]{26})$/iu.test(value);
}
