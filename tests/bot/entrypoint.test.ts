import { expect, test, vi } from 'vitest';

import { startApplication } from 'src/application.ts';

vi.mock('src/application.ts', () => ({ startApplication: vi.fn().mockResolvedValue(undefined) }));

test('the executable entry point starts the application once', async () => {
  await import('src/index.ts');
  expect(startApplication).toHaveBeenCalledOnce();
});
