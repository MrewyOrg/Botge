import { expect, test } from 'vitest';

import {
  booleanToAllowed,
  booleanToEnabled,
  booleanToString,
  stringToBoolean
} from 'src/discord/boolean-labels.ts';

test.each([true, false])('boolean labels round trip their supported values: %s', (value) => {
  expect(stringToBoolean(booleanToString(value))).toBe(value);
  expect(booleanToAllowed(value)).toBe(value ? 'allowed' : 'not allowed');
  expect(booleanToEnabled(value)).toBe(value ? 'Enabled' : 'Disabled');
});
