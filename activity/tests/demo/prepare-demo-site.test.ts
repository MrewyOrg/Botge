import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { DEMO_HEADERS, prepareDemoSite } from '../../scripts/prepare-demo-site.ts';
import { CONTENT_SECURITY_POLICY } from '../../worker/serve-activity-page.ts';

test('serves the demo as plain files with the Activity security headers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'botge-demo-'));
  try {
    await writeFile(join(directory, '.assetsignore'), '/index.html\n/7tv-cdn/\n');
    await writeFile(join(directory, 'index.html'), '<!doctype html>');
    await prepareDemoSite(directory);
    // Running twice is safe once the ignore file is gone.
    await prepareDemoSite(directory);

    expect((await readdir(directory)).toSorted()).toEqual(['_headers', 'index.html']);
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    expect(headers).toBe(DEMO_HEADERS);
    expect(headers).toContain(`Content-Security-Policy: ${CONTENT_SECURITY_POLICY}; `);
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers.startsWith('/*\n')).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
