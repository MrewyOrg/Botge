# Resource usage

Botge bounds expensive work so slow services and bursts of messages cannot grow its queues
indefinitely. These limits apply across one bot process.

| Resource          | Limit and overload behavior                                                |
| ----------------- | -------------------------------------------------------------------------- |
| Discord messages  | History cache disabled.                                                    |
| Discord members   | 200 per guild; retain the bot's member.                                    |
| Discord users     | 1,000 globally; retain the bot's user.                                     |
| Interactive menus | 100 per category; oldest removed first. Clip menus keep their limit of 15. |
| Emote rendering   | Two requests at once; extra requests receive a busy response.              |
| Composition size  | At most 32 input emotes per request.                                       |
| Downloaded assets | 25 MiB each, streamed to disk; failures remove partial files.              |
| FFmpeg            | Two-minute deadline, then forced termination.                              |
| Ollama replies    | One per channel, two globally; other messages still update context.        |
| Vector indexing   | 100 pending writes; overflow is rejected and logged.                       |

Assets are processed sequentially within each rendering request; each asset can run two metadata
probes concurrently. Existing trusted cache URLs can still be read directly by FFmpeg. The
download-size limit applies to files fetched by Node. Smaller SDK caches can cause additional REST
fetches when old entries are needed again. During sustained vector-service overload, rejected
messages are not indexed automatically later.

## Resource lifetimes

Guild removal releases live emote subscriptions and cached search-index objects, preserving user
preferences and stored documents. User assignments reference guilds by ID and reconnect when the
guild is initialized again. Startup releases saved in-memory guild state for servers missing from
the ready client's guild cache.

Reminder callbacks retain identity and delivery dependencies without the message builder or Discord
interaction. Delivery resolves the current channel and uses indexed database lookups for delivery
and recipient changes. Expired message builders are compacted in place in one pass during scheduled
cleanup after their ten-minute lifetime.

Maintenance callbacks are constructed outside startup to avoid retaining temporary startup
snapshots. AI replies release admission slots on every exit path, avoid overlapping typing requests,
and retain only the text actually sent to Discord in their rolling context.

Shortest-substring searches examine short candidates first and stop at the shortest unique length,
without allocating every possible substring.

## Validation

`npm run test:coverage` includes mocked overload, recovery, timer, cache, stream-cancellation, and
guild-lifecycle tests. Tests use temporary storage and do not connect a real Discord bot.

An isolated garbage-collection probe verified that a reminder builder could be collected while its
scheduled job and database row remained active. Synthetic benchmarks compare helper workloads;
production CPU and memory usage still need measurement under representative guild and message load.
