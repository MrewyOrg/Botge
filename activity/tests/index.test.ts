// @vitest-environment jsdom

import { expect, test, vi } from 'vitest';

import { element, waitForText } from './fixtures/activity-page.ts';

test('uses the demo when the curated catalog is empty', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([])));
  await import('../src/index.ts');
  await waitForText('#results', 'Botge');
  expect(element('#results').textContent).toContain('Demo');
});

test('reports a failed curated catalog load', async () => {
  const error = vi.spyOn(console, 'error').mockReturnValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await import('../src/index.ts');
  await waitForText('#message', 'Could not load emotes');
  expect(error).toHaveBeenCalledOnce();
});
