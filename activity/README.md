# Activity workspace

User instructions and deployment setup are maintained in the
[Activity wiki guide](https://github.com/MrewyOrg/Botge/wiki/Activity).

Browser code lives in `src/` and the signed Go origin lives in `server/`. The workspace shares the
repository's npm lockfile. Run these commands from the repository root.

`src/index.ts` initializes Discord, then creates and connects the feature modules. Ownership:

| Module                             | Responsibility                                            |
| ---------------------------------- | --------------------------------------------------------- |
| `activity-api.ts`                  | Queued OAuth session and route-specific request contracts |
| `features.ts`                      | Enabled features and target guilds from flags and launch  |
| `page-navigation.ts`               | Catalog/settings visibility and URL navigation            |
| `catalog/catalog.ts`, `seventv.ts` | Catalog parsing, filtering, and 7TV discovery requests    |
| `catalog/emote-access.ts`          | Saved emotes, permissions, and the in-flight change flag  |
| `catalog/emote-results.ts`         | Catalog paging, discovery pages, and in-place redraws     |
| `catalog/emote-tiles.ts`           | Tiles, the composer shortcut, and the right-click menu    |
| `catalog/emote-actions.ts`         | Server catalog loading and single and bulk add/remove     |
| `catalog/catalog-watch.ts`         | Live catalog updates over a ticketed WebSocket            |
| `catalog/filter-panel.ts`          | Collapsible filters, filter count, and the `/` shortcut   |
| `catalog/emote-preview.ts`         | Emote preview dialog and its actions                      |
| `catalog/emote-selection.ts`       | Bounded multi-selection and bulk controls                 |
| `composer/`                        | Layer order, composition limits, previews, and the border |
| `settings/`                        | Voice, catalog history, 7TV policy, and personal borders  |
| `game/game-state.ts`               | Guessing game message validation and connection contract  |
| `game/game-server.ts`              | Ticketed WebSocket connection to a Botge game room        |
| `game/game-view.ts`                | Game page: blurred round image, guesses, and scoreboard   |
| `demo/`                            | In-memory API, discovery, and game for the feature demo   |
| `context-menu.ts`, `validation.ts` | Shared UI and boundary helpers                            |
| `style.scss`                       | Stylesheet entry that loads the partials in cascade order |
| `styles/`                          | Theme, top bar, layout, controls, panels, and utilities   |
| `catalog/_*.scss`, `game/_*.scss`  | Catalog filters, tiles and overlays; the game page        |

Browser integration tests mirror features under `tests/`. `tests/fixtures/activity-page.ts` shares
page and Discord fixtures.

```sh
npm ci
npm run dev -w activity
npm run dev:demo -w activity
npm run build -w activity
npm test -w activity
npm run test:coverage -w activity
npm run typecheck -w activity
npm run check:markup -w activity
```

Vite serves the local preview on its printed localhost URL and builds to `activity/dist/`. The
[production staging script](../scripts/activity/stage-activity-server.sh) enables the catalog,
discovery, additions, settings, and game. HTML validation checks the source and built page, and Vite
compiles SCSS during the build.

The browser build targets Chromium 126, Firefox 133, Safari 18.4, and iOS WebKit 18.4. These are
minimum browser engine versions. For Discord desktop, check the bundled Chromium version. For
Discord on Android, check the device's WebView version. For Discord on iOS, check the system WebKit
version. Vite does not polyfill iterator helpers, `Promise.withResolvers`, or other runtime APIs.
Keep the Discord embedded browser and local Node runtime compatible when adopting newer language or
platform features.

The Activity suite tests the browser without running the bot. The [test guide](../tests/README.md)
documents its coverage gate. Rust API tests live beside
[the API implementation](../crates/botge-activity/src/activity/tests.rs).

API calls are queued. `/auth` exchanges one OAuth code for an access token, then the browser
authenticates the Discord SDK and keeps the token in memory until shortly before expiry. API
requests send that token in a bearer header; the bot checks identity and current guild permissions
for each operation. SDK waits have 15-second deadlines; HTTP calls have a 45-second deadline. Only
an HTTP 401 `oauth_expired` response renews the token and retries once. Other failures release the
queue without automatically repeating writes.

## Go Activity origin

The Go origin embeds the production Vite build and verifies Discord proxy signatures on every
content request. It serves the Activity page, curated preview catalog and static assets. The Rust
API serves the live server catalog, settings and game and authorizes its own requests.

Use the [server checks](../tests/README.md#go-activity-server) to stage the production build and
exercise the origin with synthetic keys over loopback. The command listens on all interfaces at
`PORT` and requires a 64-character hexadecimal `DISCORD_ACTIVITY_PUBLIC_KEY`. `GET /healthz` and
`HEAD /healthz` return 204 without proxy proof.

## Discord URL mappings

Enable Activities and Proxy Authentication, then enter the target hostnames without `https://` in
the Discord Developer Portal. Use the same application's public key on the Go origin and Rust bot.

| Prefix       | Target hostname                          |
| ------------ | ---------------------------------------- |
| `/`          | The Go origin's Cloud Run hostname       |
| `/botge-api` | The Rust bot's public HTTPS API hostname |
| `/7tv-api`   | `7tv.io` for discovery                   |
| `/7tv-cdn`   | `cdn.7tv.app` for emote images           |

Discord forwards browser requests to the mapped origins. The Go service serves the page and assets
independently from the bot's API. See
[Cloud Run deployment](../.github/workflows/README.md#activity-deployment-on-cloud-run).

### API HTTPS endpoint

On the bot host, use `compose.activity.yaml` with `compose.yaml` to publish the Rust API on
`127.0.0.1:3080`. On rootless control installations, include the same settings in the installation's
`compose.override.yaml`. A host-side `curl -i http://127.0.0.1:3080/healthz` should return `204`.
Set `APP_ID`, `DISCORD_ACTIVITY_PUBLIC_KEY` and `DISCORD_ACTIVITY_CLIENT_SECRET` in the bot's `.env`
and add `https://127.0.0.1` to the application's OAuth2 redirects.

For [Tailscale Funnel][funnel], join the bot host to your tailnet and enable Funnel as prompted. Run
these commands on that host:

```sh
tailscale funnel --bg http://127.0.0.1:3080
tailscale funnel status
```

Enter the resulting `.ts.net` hostname as the `/botge-api` target. Funnel makes the endpoint
reachable by Discord from the public internet while the Rust port stays on loopback. Tailscale Serve
is private to the tailnet and Discord cannot reach it.

A persistent [Cloudflare Tunnel][cloudflare-tunnel] with a Cloudflare-managed hostname can also
forward to the loopback endpoint. For a tunnel-free setup, use a public HTTPS reverse proxy with a
trusted certificate and an inbound HTTPS port. The included Compose nginx is a private 7TV image
cache. A public nginx listener needs its own TLS and reverse-proxy configuration.

Forward to the API's root and preserve Discord's signature headers, request bodies and WebSocket
upgrades. Discord must be able to reach the endpoint without an interactive login. The Rust API
verifies proxy requests and checks bearer tokens and guild permissions on protected operations.

[funnel]: https://tailscale.com/docs/reference/tailscale-cli/funnel
[cloudflare-tunnel]: https://developers.cloudflare.com/tunnel/get-started/

## Catalog history

Guild administrators can open **Catalog history** in Settings and preview a restore before
confirming it. Botge retains up to 32 revisions of individually added emotes and 7TV management
settings per guild. A restore creates a new revision. If the catalog changes after the preview,
refresh the preview before confirming again.

## Live catalog updates

After the server catalog first loads, the page asks the `catalog/watch` route for a one-use ticket
and opens a WebSocket at `/botge-api/catalog/ws`, presenting the ticket in its first message as the
game does. Botge sends `{"type":"changed"}` after an addition, removal or emote settings save in
that server, and when 7TV reports an edit to the server's 7TV set or the global set; the page then
reloads the catalog without a loading message. On a dropped connection the client reconnects and
reloads once, since changes may have been missed. Botge closes each connection after an hour, which
rechecks membership on reconnect, and a refused ticket ends watching until the Activity reopens. The
Try again button appears only after a catalog load fails. The demo has no watch, because its catalog
changes only through the page.

## Guessing game

`VITE_ENABLE_ACTIVITY_GAME=true` adds the Guess tab. Players in one Activity instance share a room:
each round shows an emote from the server's own additions and selected feeds, blurred by the page
and sharpening over 20 seconds, and the first player to type its name scores. The page asks the
`game/join` route for a one-use ticket through the queued API session, then opens a WebSocket at
`/botge-api/game/ws` and presents the ticket in its first message, because a browser cannot attach
the bearer token to a WebSocket. Round images load from `/botge-api/game/image/<token>`; the token
is random and changes every round, and the emote's name arrives only with the reveal. The page still
receives the original image, so the blur deters casual peeking rather than preventing it. Each round
opens with a three-second ready beat in which the image loads while still hidden, so a slow
connection does not cost scoring time. During the round the page shows the name as underscores, with
the first letter revealed halfway and a middle letter at three quarters (never more than a third of
the name), and lists the room's recent wrong guesses. The guess input accepts no more characters
than the name has. A lost connection is retried three times, after one, two, and four seconds,
before the page offers a Reconnect button. While a match is running the Catalog tab is disabled and
its address leads back to the game, because the catalog lists the names being guessed. Scoreboard
names come from the Discord SDK's participant list and fall back to an ID-based label.

## Feature demo

`npm run dev:demo -w activity` starts the dev server in demo mode, which loads `.env.demo` and sets
`VITE_ENABLE_ACTIVITY_DEMO=true`; plain `npm run dev` keeps the preview catalog. Outside Discord,
the flag replaces the Botge API and 7TV discovery with the in-memory backend in
`src/demo/demo-server.ts`. The demo includes the server catalog, Trending and Top pages, adding and
removing emotes, bulk actions, all settings forms except catalog history, and a single-player
guessing game with the server's rules and timings. State resets on reload and nothing reaches the
network. The page says the emotes are placeholders and hides 7TV links, whose placeholder IDs have
no 7TV page. Placeholder artwork lives in `public/7tv-cdn/demo/` so it passes server catalog
validation. The Go origin stages only approved production assets. Normal builds, the plain dev
server, and tests do not load the demo flag, and it has no effect inside Discord. The flag is read
with dot access, typed in `src/vite-env.d.ts`, so Vite replaces it with a constant: normal builds
leave out the demo backend and notice entirely, and demo builds load them as separate chunks.

## Curated preview catalog

To customize the preview catalog, add entries to `public/catalog.json` and put their images in
`public/emotes/` before building.

```json
[
  {
    "name": "ExampleWave",
    "source": "Community",
    "image": "emotes/example-wave.webp",
    "animated": false
  }
]
```

An entry can set `overlaying` to true for composer layers. This preview catalog is separate from the
authenticated guild catalog. Publish artwork only with appropriate rights.
