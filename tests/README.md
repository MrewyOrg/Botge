# Tests

Run commands from the repository root:

`.venv/bin/python scripts/doctor.py` checks development prerequisites without installing tools or
starting services. `sh scripts/check-rust.sh static`, `coverage`, `miri`, or `bench` selects an
explicit Rust scope; CI uses the same dispatcher. Coverage/Miri keep their specialized scripts and
flags.

Python tooling uses the root pinned environment and committed lockfile. Follow the
[helper setup](../scripts/README.md), then run `.venv/bin/python scripts/check_python.py` for Ruff,
strict Pyright and offline boundary tests. The pydoc build is optional. This setup also applies
inside the Dev Container.

Python validation enforces at least 90% line and branch coverage in every helper file. It includes
Python subprocesses and normalizes copied fixtures; reports are generated in `coverage/python/`.
Tests and generated files are outside the measured helper source set.

For repeatable native measurements, use
`python3 .agents/scripts/compare_benchmarks.py record /tmp/before.json` (three runs by default),
make the change, record `/tmp/after.json`, then run
`python3 .agents/scripts/compare_benchmarks.py compare /tmp/before.json /tmp/after.json`. The helper
reports median timings, rejects incompatible metadata and changing sources, and never changes
revisions. Nightly libtest supplies the benchmarks without a production dependency. Measurements are
local microbenchmarks, not production latency or allocation profiles. Tests track the catalog
future's size against a documented per-request budget. Production startup installs a fatal panic
hook: a panic in any thread reports its diagnostic and exits the process with status 101.
Recoverable operation errors still use `Result`. Unit tests retain ordinary unwinding; a subprocess
test verifies the production hook without terminating the test runner. Container restart policy owns
recovery after a programming panic.

```sh
cargo fmt --all --check
cargo clippy --workspace --locked --all-targets -- -D warnings
cargo doc --workspace --locked --no-deps --document-private-items
cargo test --workspace --locked --doc
sh scripts/check-rust-coverage.sh
cargo hack check --workspace --locked --feature-powerset --all-targets
cargo udeps --workspace --locked --all-targets
cargo miri setup
sh scripts/check-rust-miri.sh
npm run check:static
npm run test:coverage
npm run check:markup -w activity
```

Coverage commands already run the corresponding tests. Use `cargo test --locked` or a filtered
Vitest run for focused iteration. Run Activity tests and builds sequentially: Worker entry tests
mock the generated HTML module.

The Rust coverage check uses `jq` and `cargo-llvm-cov`. BotgeQL installs the latter with
`cargo install --locked --version 0.9.1 cargo-llvm-cov`.

Additional Rust verification uses pinned tools:

```sh
cargo install --locked --version 0.6.46 cargo-hack
cargo install --locked --version 0.1.61 cargo-udeps
```

Cargo-hack checks every combination of each workspace package's features across all targets.
Optional test-util features share fixtures with other packages' development dependencies; normal
production dependencies must keep them disabled. Keep development dependencies enabled so `--locked`
can preserve the committed dependency graph. Cargo-udeps checks direct dependencies across all
targets using the pinned nightly.

Miri is included in the development toolchain. Its script interprets existing tests for Discord ID
and voice-setting validation, Unicode shortcuts, layout arithmetic, and WebP metadata/timing. It
keeps default isolation and undefined-behavior checks enabled. Network, database, native audio, and
FFmpeg paths and larger stress fixtures remain in the normal coverage suite; this is not full-bot
Miri coverage. Extend the script's filters when adding pure Rust tests that can run under Miri.

Rust unit tests live next to their modules in the owning workspace crate. The CLI integration tests
live in `crates/botge/tests/rust_cli.rs` and exercise the compiled binary. Unit tests can access
private code and use local provider and Discord fixtures and temporary redb databases. Render tests
need FFmpeg 9 or later with libwebp and FFprobe. BotgeQL requires at least 95% branch, line,
function, and region coverage in every Rust source file. To export the Rust coverage report as HTML,
run `sh scripts/check-rust-coverage.sh --html --output-dir coverage/rust`.

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

The pre-commit hook runs lint-staged using installed dependencies. Run `npm ci` before committing
when dependencies need installation. It builds the Activity only when staged browser source, assets,
or build/dependency configuration changes; documentation-only and Rust-only commits skip that build.
CI still runs the checks selected by the complete PR diff.

After a merge changes dependency manifests, the post-merge hook prints a reminder instead of
installing packages. Run `npm ci` at the repository root for the shared workspace, or
`npm --prefix tests/integration ci` for the separate Compose test project when its dependencies
change. Docker image cleanup is a manual operator task; `npm start` only builds and starts Compose.
Changes to Python tooling manifests prompt `uv sync --locked`; the hook never installs tools.

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

Workspace dependency direction and test ownership are documented in the
[workspace guide](../crates/README.md). The architecture integration test checks real Cargo
metadata.
