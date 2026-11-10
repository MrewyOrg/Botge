import html from '../../dist/activity/index.html';
import { type ActivityPageRequest, serveActivityPage } from './serve-activity-page.ts';

export default {
  fetch(
    request: ActivityPageRequest,
    env: Readonly<{ DISCORD_ACTIVITY_PUBLIC_KEY?: string }>
  ): Response {
    return serveActivityPage(request, env.DISCORD_ACTIVITY_PUBLIC_KEY, html);
  }
};
