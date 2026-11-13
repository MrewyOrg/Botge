# Activity workspace

User instructions and deployment setup are maintained in the
[Activity wiki guide](https://github.com/MrewyOrg/Botge/wiki/Activity).

Browser code lives in `src/`, and the Cloudflare entry point and proxy authentication live in
`worker/`. The workspace shares the repository's npm lockfile. Run these commands from the
repository root.

`src/index.ts` coordinates catalog loading and Discord initialization. Feature ownership:

| Module                             | Responsibility                                             |
| ---------------------------------- | ---------------------------------------------------------- |
| `activity-api.ts`                  | Queued OAuth session and route-specific request contracts  |
| `page-navigation.ts`               | Catalog/settings visibility and URL navigation             |
| `catalog/`                         | Parsing, discovery, preview actions, and bounded selection |
| `composer/`                        | Layer order, composition limits, and previews              |
| `settings/`                        | Voice, provider/role policy, and personal border forms     |
| `context-menu.ts`, `validation.ts` | Shared UI and boundary helpers                             |

Tests mirror features under `tests/`, including browser integration suites and Worker tests.
`tests/fixtures/activity-page.ts` shares page and Discord fixtures.

```sh
npm ci
npm run dev -w activity
npm run build -w activity
npm test -w activity
npm run test:coverage -w activity
npm run typecheck -w activity
npm run check:markup -w activity
```

Vite serves the local demo on its printed localhost URL and builds to `activity/dist/`. Production
feature flags and Discord URL mappings are documented in the wiki. HTML validation checks the source
and built page, and Vite compiles SCSS during the build.

The browser build targets `esnext` and requires ES2025 iterator helpers and `Promise.withResolvers`;
Vite does not polyfill these runtime APIs. Keep the Discord embedded browser and local Node runtime
compatible when adopting newer language or platform features.

The Activity suite covers the browser and Worker without running the bot. Coverage reports go to
`coverage/activity/`, with a 90% minimum for statements, branches, functions, and lines per runtime
source file. Declaration-only `.d.ts` files have no runtime code and are excluded. The root
`npm run test:coverage` command applies the same gate to repository tooling and the Activity. Rust
API tests live beside [the API implementation](../src/activity/tests.rs). See the
[test guide](../tests/README.md).

API calls are queued. `/auth` exchanges one OAuth code for an access token, then the browser
authenticates the Discord SDK and keeps the token in memory until shortly before expiry. API
requests send that token in a bearer header; the bot checks identity and current guild permissions
for each operation. SDK waits have 15-second deadlines; HTTP calls have a 45-second deadline. Only
an HTTP 401 `oauth_expired` response renews the token and retries once. Other failures release the
queue without automatically repeating writes.

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
