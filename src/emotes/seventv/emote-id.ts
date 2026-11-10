export function isSevenTVEmoteId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{24}|[a-z0-9]{26})$/iu.test(value);
}
