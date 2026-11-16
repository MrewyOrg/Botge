/* Turns a demo-mode Vite build into a static-only site for Cloudflare Workers static assets. */

import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CONTENT_SECURITY_POLICY } from '../worker/serve-activity-page.ts';

/**
 * Security headers for every demo response, in Cloudflare's `_headers` format.
 *
 * @remarks
 * The demo reuses the Activity page's Content Security Policy. It never runs inside Discord, so it
 * also refuses framing. Nothing in the demo is private, so normal caching applies.
 */
export const DEMO_HEADERS: string = [
  '/*',
  `  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`,
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  ''
].join('\n');

/**
 * Prepares a built demo directory for static-only hosting.
 *
 * @remarks
 * The shared `public/.assetsignore` hides `index.html` and the placeholder art from the Activity
 * Worker's asset routes. The demo serves both as plain files, so the copied ignore file is removed.
 * A `_headers` file replaces the headers the Activity Worker would otherwise add.
 *
 * @param directory - The demo build output, such as `dist-demo`.
 * @throws `Error` if the directory cannot be written.
 */
export async function prepareDemoSite(directory: string): Promise<void> {
  await rm(join(directory, '.assetsignore'), { force: true });
  await writeFile(join(directory, '_headers'), DEMO_HEADERS);
}

if (import.meta.main) await prepareDemoSite(process.argv[2] ?? 'dist-demo');
