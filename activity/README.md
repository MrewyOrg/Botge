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
| `demo/`                            | In-memory API and discovery for the local feature demo    |
| `context-menu.ts`, `validation.ts` | Shared UI and boundary helpers                            |

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

## Feature demo

`npm run dev:demo -w activity` starts the dev server in demo mode, which loads `.env.demo` and sets
`VITE_ENABLE_ACTIVITY_DEMO=true`; plain `npm run dev` keeps the preview catalog. Outside Discord,
the flag replaces the Botge API and 7TV discovery with the in-memory backend in
`src/demo/demo-server.ts`. Every guild feature is then available against a pretend server: the
server catalog, Trending and Top pages, adding and removing emotes, bulk actions, and all settings
panels. State resets on reload and nothing reaches the network. The page says the emotes are
placeholders and hides 7TV links, whose placeholder IDs have no 7TV page. Placeholder artwork lives
in `public/7tv-cdn/demo/` so it passes server catalog validation; `.assetsignore` keeps it out of
the Activity Worker. Normal builds, the plain dev server, and tests do not load the demo flag, and
it has no effect inside Discord. The flag is read with dot access, typed in `src/vite-env.d.ts`, so
Vite replaces it with a constant: normal builds leave out the demo backend and notice entirely, and
demo builds load them as separate chunks.

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
