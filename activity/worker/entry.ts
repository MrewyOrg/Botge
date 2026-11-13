// Bundle the HTML in the Worker. public/.assetsignore keeps it off the public asset routes.
import html from '../dist/index.html';
import { type ActivityPageRequest, serveActivityPage } from './serve-activity-page.ts';

/**
 * Cloudflare request adapter for the bundled Activity page.
 *
 * @see {@link serveActivityPage}
 */
export default {
  fetch(
    request: ActivityPageRequest,
    env: { readonly DISCORD_ACTIVITY_PUBLIC_KEY?: string }
  ): Response {
    return serveActivityPage(request, env.DISCORD_ACTIVITY_PUBLIC_KEY, html);
  }
};
