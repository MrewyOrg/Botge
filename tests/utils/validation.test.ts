import { expect, test } from 'vitest';

import { requireValue } from 'src/utils/validation.ts';

test.each([0, false, ''])('required values preserve valid falsy data: %j', (value) => {
  expect(requireValue(value, 'Missing value')).toBe(value);
});

test.each([undefined, null])('required values fail with context for missing data: %s', (value) => {
  expect(() => requireValue(value, 'Missing resolved asset')).toThrow('Missing resolved asset');
});
