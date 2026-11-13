# Tests

Run commands from the repository root:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo doc --locked --no-deps --document-private-items
sh scripts/check-rust-coverage.sh
npm run check:static
npm run test:coverage
npm run check:markup -w activity
```

Coverage commands already run the corresponding tests. Use `cargo test --locked` or a filtered
Vitest run for focused iteration. Run Activity tests and builds sequentially: Worker entry tests
mock the generated HTML module.

The Rust coverage check uses `jq` and `cargo-llvm-cov`. BotgeQL installs the latter with
`cargo install --locked --version 0.9.1 cargo-llvm-cov`.

Rust unit tests live next to their modules in `src/`. The CLI integration tests live in
`tests/rust_cli.rs` and exercise the compiled binary. Unit tests can access private code and use
local provider and Discord fixtures and temporary redb databases. Render tests need FFmpeg 9 or
later with libwebp and FFprobe. BotgeQL requires at least 90% branch, line, function, and region
coverage in every Rust source file. To export the Rust coverage report as HTML, run
`sh scripts/check-rust-coverage.sh --html --output-dir coverage/rust`.

The [Activity tests](../activity/README.md) exercise the browser and Worker. Run
`npm run test:coverage` to enforce at least 90% statements, branches, functions, and lines per
TypeScript runtime source file, including repository configuration, the Activity, and its Worker.
The combined report is in `coverage/typescript/`. Use `npm run test:coverage -w activity` for the
Activity-only report in `coverage/activity/`. Declaration-only `.d.ts` files are excluded because
they contain no runtime code.

Repository tooling tests exercise lint, formatting, spelling, commit policy, and the control
protocol. Type checking also validates the Activity's `expectTypeOf` contract assertions; Vitest
execution alone does not. The combined [root Vitest config](../vitest.config.ts) runs both the
tooling and Activity suites. Control tests use temporary command stubs in place of the Docker daemon
and control socket.

## Compose integration

The Compose suite has its own package and lockfile. Install its dependencies and run it from the
repository root:

```sh
npm --prefix tests/integration ci
npm --prefix tests/integration run typecheck
BOTGE_TEST_COMPOSE=true npm --prefix tests/integration test
```

The test requires Docker, `.env`, and `botge.config.json`. It logs a real bot into Discord, so check
for an existing stack before running it. It builds the Rust Compose stack with command registration
disabled, an isolated project name, named volumes, and a temporary nginx cache.
