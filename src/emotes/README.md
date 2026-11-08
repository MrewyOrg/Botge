# Emotes

`EmoteCatalog` stores each provider/ID/name once. Exact lookups use an index; substring searches
scan normalized names in linear time. Source arrays are immutable snapshots; replacing one rebuilds
indexes on the next query without replacing the catalog.

`GlobalEmoteStore` loads global sources; `PersonalEmoteStore` owns guild settings, personal sources,
and added emotes. Priority is 7TV global, BTTV global, FFZ global, Twitch global, 7TV personal, BTTV
channel, BTTV shared, FFZ personal, then added emotes. Matching prefers exact case, case-insensitive
exact names, then substrings in source order. Autocomplete ranks exact names, prefixes, then
substrings, with provider, animation, zero-width, and personal filters. Added emotes hidden by a
same-name set emote reappear when that set emote is removed.

7TV sources are enabled independently with `use7TVGlobalEmotes` (the global set),
`use7TVPersonalEmotes` (server-configured sets), and `use7TVAddedEmotes` (individually added emotes
and direct 7TV URLs). Catalog emotes use their source switch, so global and personal sets can work
without permitting standalone URLs. The `useBTTVEmotes`, `useFFZEmotes`, and `useTwitchEmotes`
switches apply to all sources from their respective providers. All switches default to false.
Disabled sources are not fetched or subscribed to, and their emotes are absent from catalogs,
autocomplete, and rendering. Stored set references and added records remain for later re-enabling.
Known provider emote URLs are checked during rendering; unrelated external images and mirrors cannot
be classified by artwork ownership. Restart Botge after changing these switches.

## Live 7TV sets

`seventv/event-client.ts` uses Node's built-in global `WebSocket`. Keep WebSocket enabled in
`node.config.json`. No additional package or 7TV credentials are required.

- Initial set contents come from the v3 HTTP API, since the event stream only supplies changes.
- One connection shares reference-counted `emote_set.*` subscriptions between guilds and global
  sources. Dispose a watch when its set is replaced or its owner is discarded.
- Additions, aliases, removals, and set deletions update the snapshot directly. Unknown or nested
  patches trigger a coalesced HTTP refresh, keeping partial payload handling conservative.
- Each subscription ACK triggers a snapshot refresh to cover changes between the initial fetch and
  subscription, including changes missed while disconnected. Notifications during that refresh
  cannot be silently lost.
- Missed heartbeats and recoverable disconnects reconnect with exponential backoff and jitter.
  Maintenance waits at least five minutes. Protocol/authentication/rate-limit errors stop the client
  and are logged; fix the cause and restart the application.
- Failed recovery requests retain the last snapshot and retry. A deleted set's 404 clears its
  emotes.
- The server's subscription limit is respected and logged if exceeded. Pending sets can be watched
  after capacity becomes available; deployments exceeding one connection's limit need sharding.
- Shutdown closes the client and clears its timers. It cannot restart from a late network result.

BTTV/FFZ/Twitch retain their scheduled HTTP refreshes. Added standalone 7TV emotes load on startup
or `/emote-add`; their original IDs remain the removal key even when an alias is absent or changes.

Protocol references:
[7TV event server](https://github.com/SevenTV/SevenTV/tree/main/apps/event-api),
[7TV wire types](https://github.com/SevenTV/SevenTV/blob/main/shared/src/event_api/types.rs), and
[Node WebSocket](https://nodejs.org/api/globals.html#class-websocket).

## Supporting modules

- `platforms.ts`: platform labels and emote page/API links.
- `provider-urls.ts`: validate user links and look up provider set URLs. Missing BTTV/FFZ channel
  sets return feedback; provider outages return errors.
- `personal-emote-sets.ts`: readonly persisted URL data, with null disabling a provider.
- `emote-to-asset.ts`: provider response conversion and 7TV file selection. Stores skip invalid
  entries individually.
- `rendering/`: URL/emoji parsing, validated provider sizes, bounded downloads, and FFprobe
  metadata. Resizing retains aliases, flags, timestamps, and personal-set membership; downloads
  reject HTTP errors before saving their bodies.

The SQLite schemas and saved provider API URLs are unchanged.
