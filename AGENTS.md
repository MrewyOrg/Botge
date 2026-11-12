# Project guidance

Botge is a Rust Discord bot for emotes and voice. The Discord Activity and Cloudflare Worker remain
TypeScript. Start with the [README](README.md) and [architecture guide](docs/ARCHITECTURE.md). The
[wiki](https://github.com/MrewyOrg/Botge/wiki) is the main user and hosting documentation. Keep
implementation references versioned in the repository and avoid duplicating wiki guides.

## Project map

- `src/main.rs` starts the Discord gateway, Activity API, and workers. `src/config.rs` reads
  operator settings, including provider opt-ins.
- `src/commands.rs` owns the Discord emote command definitions, registration, and replies.
  `src/commands/clear.rs` handles message cleanup. `src/discord.rs` handles gateway events, OAuth
  identity, and guild permissions.
- `src/emotes/` handles provider snapshots, 7TV events, and bounded image rendering.
  `src/activity.rs` exposes the catalog, added emotes, and settings through Axum. `src/proxy.rs`
  verifies Discord's Activity proxy signatures.
- `src/storage.rs` owns redb transactions. `src/voice.rs` reconciles saved guild settings with
  Discord voice state.
- `activity/` is an npm workspace with its own browser and Worker tests. See its
  [workspace guide](activity/README.md). Root `vitest.config.ts` runs both the Activity and tooling
  suites. See the [test guide](tests/README.md) for integration tests.
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
  `cargo doc --locked --no-deps --document-private-items`.
- Rust coverage: `sh scripts/check-rust-coverage.sh`. BotgeQL requires above 80% branch coverage and
  at least 80% line, function, and region coverage per source file. Tests use loopback provider and
  Discord fixtures, temporary redb databases, and FFmpeg 9 or later with libwebp and FFprobe. The
  opt-in Compose test connects to Discord.
- TypeScript checks: `npm run check` runs the shared tooling and Activity checks. Use
  `npm run test:coverage -w activity` for Activity coverage and `npm run check:markup -w activity`
  for its build, HTML, and SCSS validation.
- Documentation and tooling: `npm run markdownlint`, `npm run cspell`, `npm run lint:shell`, and
  `npm run lint:workflows`. Use Prettier for supported non-Rust files and Regal for Rego.

Choose checks appropriate to the change. Report failures and checks you could not run.

## Implementation conventions

- Start with Rustdoc to find the relevant modules and understand their contracts. Read the
  implementation when changing behavior or verifying security, state, or concurrency guarantees.
  Describe defaults, failure cases, and side effects at boundaries. Keep helper and data type
  comments brief, and update them with the code.
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
  their modules, use readonly types for snapshots, and validate untrusted input.
- Keep runtime defaults, example config, schema, and setup docs aligned. Use `.env.example` for new
  environment options.
- Update diagrams only when a change makes their depicted components, relationships, or flows
  inaccurate. Minor fixes, formatting, dependency updates, and internal refactors that leave the
  depicted behavior unchanged do not require diagram updates. Update only the affected PNGs in the
  same change: `docs/architecture.png`, `docs/request-flow.png`, `docs/deployment.png`,
  `docs/development-workflow.png`, `docs/startup.png`, and `docs/discord-interactions.png`. Keep
  their modern dark style consistent and verify labels and connections against the implementation.
  Update the corresponding Mermaid diagrams and diagram links in `docs/ARCHITECTURE.md` as needed.

## Workspace and deployment

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
