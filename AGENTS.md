# Project guidance

Botge is a Rust Discord bot for emotes and voice. The Discord Activity and Cloudflare Worker remain
TypeScript. Start with the [README](README.md) and [architecture guide](docs/ARCHITECTURE.md). The
[wiki](https://github.com/MrewyOrg/Botge/wiki) is the main user and hosting documentation. Keep
implementation references versioned in the repository and avoid duplicating wiki guides.

## Project map

- `src/main.rs` starts the Discord gateway, Activity API, and workers. `src/config.rs` reads
  operator settings, including provider opt-ins.
- `src/commands.rs` dispatches Discord commands. `src/commands/` separates composition, message
  prefixes, autocomplete, shortcuts, registration, and message cleanup. `src/discord.rs` handles
  gateway events, OAuth identity, and guild permissions.
- `src/emotes/` handles provider snapshots, 7TV events, and bounded image rendering. Provider
  normalization lives in `providers/normalization.rs`; rendering layout, media probing, and WebP
  timing live in `rendering/`.
- `src/activity.rs` owns shared Axum state, authentication, and request limits. `src/activity/`
  separates voice, catalog, and personal border routes. `src/proxy.rs` verifies Discord's Activity
  proxy signatures.
- `src/storage.rs` owns redb transactions. `src/voice.rs` reconciles saved guild settings with
  Discord voice state.
- `activity/` is an npm workspace with its own browser and Worker tests. See its
  [workspace guide](activity/README.md). `activity/src/index.ts` wires the browser; `catalog/`,
  `composer/`, and `settings/` group its features, with matching test folders. `activity-api.ts`
  owns the browser's queued OAuth session, and `activity/worker/` verifies HTML requests. Root
  `vitest.config.ts` runs both the Activity and tooling suites. See the
  [test guide](tests/README.md) for integration tests.
- `Dockerfile` builds the Rust production image. `compose.yaml` runs Botge and nginx, and
  `compose.build.yaml` selects a local build. `compose.activity.yaml` exposes the Activity API on
  the host loopback interface. Read the [control guide](botge_control/README.md) before changing
  deployment tooling.

## Development and validation

Use the dated Rust nightly in `rust-toolchain.toml`, Cargo's committed lockfile, and npm with the
committed workspace lockfile. Follow `.nvmrc` and the package engines. Install Node dependencies
with `npm ci`.

- Rust checks: `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`, and
  `cargo test --locked`. `Cargo.toml` defines the lint policy. Check Rustdoc with
  `cargo doc --locked --no-deps --document-private-items`. Clippy's `all`, `pedantic`, and `nursery`
  groups are denied; select compatible `restriction` lints individually. Prefer local
  `#[expect(..., reason = "...")]` for intentional patterns. Keep broader allowances limited to
  documented project conventions or test fixture policies.
- Rust coverage: `sh scripts/check-rust-coverage.sh`. BotgeQL requires at least 90% branch, line,
  function, and region coverage per source file. Tests use loopback provider and Discord fixtures,
  temporary redb databases, and FFmpeg 9 or later with libwebp and FFprobe. The opt-in Compose test
  connects to Discord.
- TypeScript checks: `npm run check` runs the shared tooling and Activity checks. Use
  `npm run test:coverage` to enforce at least 90% statements, branches, functions, and lines per
  TypeScript source file across the Activity, Worker, and repository tooling. Use
  `npm run test:coverage -w activity` for Activity-only coverage and
  `npm run check:markup -w activity` for its build, HTML, and SCSS validation. Run Activity builds
  and tests sequentially: the Worker entry tests mock the generated HTML module, which a concurrent
  build can replace.
- Documentation and tooling: `npm run markdownlint`, `npm run cspell`, `npm run lint:shell`, and
  `npm run lint:workflows`. Use Prettier for supported non-Rust files and Regal for Rego.

Choose checks appropriate to the change. Report failures and checks you could not run. If using
CodeQL, keep databases in `.github/codeql/database/` and reports in `.github/codeql/output/`. Use
`.github/codeql/codeql-config.yml` to exclude generated files and the suites configured by
`.github/workflows/codeql.yml`; keep generated artifacts out of commits. Local CodeQL analysis is
optional, not a pre-push requirement.

## Implementation conventions

- Continuously look for modern code patterns and replace older approaches when doing so improves
  correctness, clarity, or efficiency. This applies to all languages, including tests and tooling.
  Check Rust against the pinned nightly and TypeScript against the configured compiler, Node,
  bundler, and browser targets. Experimental Rust and TypeScript features are allowed when they
  provide a concrete benefit; document feature gates or runtime requirements and verify support
  across the affected targets. Keep dependencies, CI, Docker, documentation, and tests aligned.
- Start with Rustdoc to find the relevant modules and understand their contracts. Read the
  implementation when changing behavior or verifying security, state, or concurrency guarantees.
  Describe defaults, failure cases, and side effects at boundaries. Keep helper and data type
  comments brief, and update them with the code.
- Use `//!` for crate/module documentation, `///` for items, and `//` for implementation notes.
  Fallible APIs, including private helpers, need accurate `# Errors` sections. Document actual panic
  conditions under `# Panics` and unsafe caller obligations under `# Safety` only when applicable.
  Use intra-doc links and useful examples; keep non-Rust examples in explicitly labeled code fences.
  `Cargo.toml` and `clippy.toml` enforce the documentation policy. Test modules locally exempt
  error/panic section requirements because fixture errors and assertion panics describe test
  failures; production helpers remain checked.
- Use conventional Rust names and rustfmt with the repository's two-space indentation. Keep features
  focused, interfaces small, and errors explicit. Keep Discord and Axum concerns in their adapters
  and redb transactions in storage. Run blocking database operations off the async executor.
- Validate provider, Discord, and browser input at the boundary. Preserve provider opt-in switches.
  Verify guild membership and action permissions in the API before writing. Bound external requests
  and rendering work.
- Test observable behavior, especially denied requests, concurrent changes, and reconnects. Put Rust
  unit tests beside their modules in `tests.rs` so coverage measures production code.
- For TypeScript, use two spaces, single quotes, semicolons, and ESM imports with `.ts` relative
  extensions. Group imports by Node, dependencies, and project code. Keep type-only imports beside
  their modules, use `ts-essentials` `DeepReadonly` for nested data snapshots, and validate
  untrusted input. Prefer readonly types by default wherever mutation is unnecessary: explicit
  `readonly` properties for flat records, `readonly T[]` arrays, readonly tuples, and `ReadonlyMap`
  or `ReadonlySet` for collection views. Apply this to parameters, return types, snapshots, and
  local collections that are only read, including tests and tooling. Keep working collections
  mutable when building or reordering state. Use utility types and correlated unions to express real
  invariants; keep mutable DOM and SDK capabilities separate from immutable data. Type assertions
  must not replace boundary validation.
- Keep the Activity's single `@packageDocumentation` comment in `activity/src/index.ts`. Use
  ordinary comments for other file overviews so they cannot attach to the next declaration. Put
  TSDoc immediately above the declaration it describes. Use applicable parameter, return, error,
  generic, remarks, example, and cross-reference tags; keep built-in exception names in code spans
  rather than unresolved symbol links.
- Use ordinary explanatory comments instead of Better Comments color markers. Rust's `//!` syntax is
  native module documentation and must retain its Rustdoc scope.
- Keep runtime defaults, example config, schema, and setup docs aligned. Use `.env.example` for new
  environment options.
- Do not automatically regenerate or edit PNG diagrams in `docs/`. Update them only when the user
  explicitly requests it. When requested, keep their modern dark style consistent and verify labels
  and connections against the implementation. Keep Mermaid diagrams and diagram links in
  `docs/ARCHITECTURE.md` aligned with relevant source changes.

## Workspace and deployment

- Keep all project tooling and services free to use. Use public-repository standard GitHub Actions
  runners. Do not introduce paid managed services, larger runners, paid storage, or trial-credit
  dependencies. Verify free-tier limits and spending controls before proposing hosted resources; a
  free CLI or control plane does not make its infrastructure free. See
  [the cost policy](docs/PRODUCTION.md#cost-policy).
- Preserve existing uncommitted work. A request to check code includes correctness, modernity, and
  useful fixes within its purpose.
- Treat `.env` and `botge.config.json` as local configuration. Preserve `data/`, SQLite and redb
  files, Docker volumes, and nginx cache. Keep credentials out of logs, tests, and commits.
- Edit source files. Leave generated `target/`, `activity/dist/`, `coverage/`, and `node_modules/`
  alone.
- Use a separate Discord application for live testing. Enable command registration locally only with
  that test application. Check for an existing stack before running the Compose test.
- Validate deployment scripts without executing setup, teardown, import, or deployment as routine
  checks. Keep the approval-gated pre-merge deployment described in the
  [workflow guide](.github/workflows/README.md).
