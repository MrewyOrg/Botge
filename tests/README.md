# Tests

Run commands from the repository root:

```sh
cargo test --locked
sh scripts/check-rust-coverage.sh
npm test -w activity
npm test -- --run --project Tooling
npm run typecheck
```

The Rust coverage check uses `jq` and `cargo-llvm-cov`. BotgeQL installs the latter with
`cargo install --locked --version 0.9.1 cargo-llvm-cov`.

Rust unit tests live next to their modules in `src/`. The CLI integration tests live in
`tests/rust_cli.rs` and exercise the compiled binary. Unit tests can access private code and use
local provider and Discord fixtures and temporary redb databases. Render tests need FFmpeg 9 or
later with libwebp and FFprobe. BotgeQL requires more than 80% branch coverage and at least 80%
line, function, and region coverage in every Rust source file. To export the Rust coverage report as
HTML, run `sh scripts/check-rust-coverage.sh --html --output-dir coverage/rust`.

The [Activity tests](../activity/README.md) exercise the browser and Worker. Run
`npm run test:coverage -w activity` for its coverage report in `coverage/activity/`.

Repository tooling tests exercise the ESLint configuration and the control protocol. The combined
[root Vitest config](../vitest.config.ts) runs both the tooling and Activity suites. Control tests
use temporary command stubs in place of the Docker daemon and control socket.

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
