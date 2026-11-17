# Activity workspace

User instructions and deployment setup are maintained in the
[Activity wiki guide](https://github.com/MrewyOrg/Botge/wiki/Activity).

Browser code lives in `src/`, and the Cloudflare entry point and proxy authentication live in
`worker/`. The workspace shares the repository's npm lockfile. Run these commands from the
repository root.

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
| `catalog/filter-panel.ts`          | Collapsible filters, filter count, and the `/` shortcut   |
| `catalog/emote-preview.ts`         | Emote preview dialog and its actions                      |
| `catalog/emote-selection.ts`       | Bounded multi-selection and bulk controls                 |
| `composer/`                        | Layer order, composition limits, previews, and the border |
| `settings/`                        | Voice, provider/role policy, and personal border forms    |
| `game/game-state.ts`               | Guessing game message validation and connection contract  |
| `game/game-server.ts`              | Ticketed WebSocket connection to a Botge game room        |
| `game/game-view.ts`                | Game page: blurred round image, guesses, and scoreboard   |
| `demo/`                            | In-memory API, discovery, and game for the feature demo   |
| `context-menu.ts`, `validation.ts` | Shared UI and boundary helpers                            |
| `style.scss`                       | Stylesheet entry that loads the partials in cascade order |
| `styles/`                          | Theme, top bar, layout, controls, panels, and utilities   |
| `catalog/_*.scss`, `game/_*.scss`  | Catalog filters, tiles and overlays; the game page        |

Tests mirror features under `tests/`, including browser integration suites and Worker tests.
`tests/fixtures/activity-page.ts` shares page and Discord fixtures.

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

Vite serves the local preview on its printed localhost URL and builds to `activity/dist/`.
Production feature flags and Discord URL mappings are documented in the wiki. HTML validation checks
the source and built page, and Vite compiles SCSS during the build.

The browser build targets `esnext` and requires ES2025 iterator helpers and `Promise.withResolvers`;
Vite does not polyfill these runtime APIs. Keep the Discord embedded browser and local Node runtime
compatible when adopting newer language or platform features.

The Activity suite covers the browser and Worker without running the bot; the
[test guide](../tests/README.md) owns its coverage gate. Rust API tests live beside
[the API implementation](../crates/botge-activity/src/activity/tests.rs).

API calls are queued. `/auth` exchanges one OAuth code for an access token, then the browser
authenticates the Discord SDK and keeps the token in memory until shortly before expiry. API
requests send that token in a bearer header; the bot checks identity and current guild permissions
for each operation. SDK waits have 15-second deadlines; HTTP calls have a 45-second deadline. Only
an HTTP 401 `oauth_expired` response renews the token and retries once. Other failures release the
queue without automatically repeating writes.

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
`src/demo/demo-server.ts`. Every guild feature is then available against a pretend server: the
server catalog, Trending and Top pages, adding and removing emotes, bulk actions, all settings
panels, and a single-player guessing game with the server's rules and timings. State resets on
reload and nothing reaches the network. The page says the emotes are placeholders and hides 7TV
links, whose placeholder IDs have no 7TV page. Placeholder artwork lives in `public/7tv-cdn/demo/`
so it passes server catalog validation; `.assetsignore` keeps it out of the Activity Worker. Normal
builds, the plain dev server, and tests do not load the demo flag, and it has no effect inside
Discord. The flag is read with dot access, typed in `src/vite-env.d.ts`, so Vite replaces it with a
constant: normal builds leave out the demo backend and notice entirely, and demo builds load them as
separate chunks.

### Publishing the demo

`npm run build:demo -w activity` builds with `.env.demo` into `activity/dist-demo/`, then
`scripts/prepare-demo-site.ts` removes the copied `.assetsignore` and writes a `_headers` file with
the Activity page's Content Security Policy, `frame-ancestors 'none'`, `nosniff`, and `no-referrer`.
[`wrangler.demo.jsonc`](wrangler.demo.jsonc) deploys that directory as static assets with no Worker
script. Cloudflare serves static asset requests free, and they do not count toward the account's
daily Worker request limit that the Activity shares.

Deploy it from the repository root, like the Activity Worker but with the demo build and config. The
first deploy creates the `botge-activity-demo` Worker. It needs no `--var`, because no Worker script
runs:

```sh
npm run build:demo -w activity
npm exec --ignore-scripts --package=wrangler -- \
  wrangler deploy --config activity/wrangler.demo.jsonc
```

Keep both Workers on the Free plan; see the [cost policy](../docs/PRODUCTION.md#cost-policy). GitHub
READMEs cannot run the demo, so link to its URL instead.

## Curated preview catalog

For a local or public demo, add entries to `public/catalog.json` and put their images in
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
