# Tests and checks

This guide owns check commands, coverage gates, toolchains and prerequisites, and which checks a
change needs. Other documents link here instead of repeating them. Run commands from the repository
root.

## Setup

- **Rust:** install through rustup. `rust-toolchain.toml` pins the nightly used for development and
  checks. Production code must also build on the stable `rust-version` in `Cargo.toml`, which the
  Docker image uses; nightly-only features stay in tests and benchmarks.
- **Native libraries:** Opus with `pkg-config` (`opus` on Homebrew, `libopus-dev` on Debian). Render
  tests need FFmpeg 9 or later with libwebp and FFprobe. The coverage check needs `jq`.
- **Rust test tools:** `cargo-llvm-cov`, `cargo-hack` and `cargo-udeps`, pinned in the
  [CI setup action](../.github/actions/rust-setup/action.yml). Install the same versions with
  `cargo install --locked --version VERSION TOOL`.
- **Node:** the `.nvmrc` version, then `npm ci`.
- **Python:** follow the [helper guide](../scripts/README.md), which owns Python setup and checks.
- **iOS:** macOS with Xcode 27, then `npm run setup:ios` once for the pinned XcodeGen, SwiftFormat
  and SwiftLint. The [iOS guide](../ios/README.md) covers signing and troubleshooting.

`.venv/bin/python scripts/setup/doctor.py` reports missing prerequisites without installing
anything.

## Checks

- **`sh scripts/rust/check-rust.sh static`.** rustfmt, Clippy, private Rustdoc and doctests
- **`sh scripts/rust/check-rust.sh dependencies`.** feature combinations, unused dependencies
  (slowest)
- **`sh scripts/rust/check-rust.sh coverage`.** all Rust tests and the per-file coverage gate
- **`sh scripts/rust/check-rust.sh miri`.** pure Rust tests (after `cargo miri setup`)
- **`sh scripts/rust/check-rust.sh bench`.** nightly libtest benchmarks
- **`npm run check:static`.** Types, ESLint (TS and HTML), Stylelint, unused code
- **`npm run test:coverage`.** Activity and tooling tests + gate
- **`npm run check:markup -w activity`.** Activity build, HTML validation
- **`npm run markdownlint`.** Markdown
- **`npm run lint:shell`.** ShellCheck
- **`npm run test:shell`.** Bats and per-file shell line coverage
- **`npm run lint:workflows`.** actionlint, including composite actions
- **`.venv/bin/python scripts/quality/check_python.py`.** Python helpers (see the helper guide)
- **`npm run check:ios`.** SwiftFormat lint and strict SwiftLint
- **`npm run check:ios:analyze`.** SwiftLint analyzer: unused declarations and imports
- **`npm run test:ios`.** iOS unit and UI tests, Swift coverage gate
- **`npm run test:ios:lockdown`.** Lockdown test plan (simulator in Lockdown Mode)
- **`npm run test:ios:only -- EmoteLinkTests`.** Named iOS suites or tests, one result line per test

CI runs the same commands. Coverage commands already run their tests, so don't repeat a passing
suite. For focused iteration, use a filtered `cargo test --locked`, Vitest or
`npm run test:ios:only` run.

To reproduce the iOS CI build, run `sh scripts/ios/check-ios.sh ci`. It captures the compiler log
for SwiftLint, runs the serial simulator suite using the same instrumented products, and checks
coverage. The Linux tooling job runs `python scripts/ios/check_swift_docs.py` separately.

### Go Activity server

Use the Go patch pinned in [`activity/server/.go-version`](../activity/server/.go-version) with cgo
enabled for the race detector. Install `gopls`, `golangci-lint` v2.15.0 and `govulncheck` on `PATH`.
Check prerequisites with `.venv/bin/python scripts/setup/doctor.py --go`. Stage the production
assets and run the same checks BotgeQL uses.

```sh
npm ci
sh scripts/activity/stage-activity-server.sh
sh scripts/activity/check-activity-server.sh
```

The staging command builds with all production feature flags and prints the byte totals for the
three encodings. The check script verifies the linter configuration, runs its code, documentation
and formatting checks, and checks struct field comments. The race-enabled test run exercises the
embedded build over loopback with synthetic Ed25519 keys. Go writes the test and subprocess profiles
using `go test` and `GOCOVERDIR`. The pinned
[go-test-coverage](https://github.com/vladopajic/go-test-coverage) CLI combines the profiles and
enforces 90% statement coverage per measured file. Find the profiles and threshold report in
`coverage/go/`. Run tests that change Vite build outputs serially with this check.

The script also scans the production source and a static Linux AMD64 build with pinned
`govulncheck`.

Run bounded fuzzing locally from a staged checkout. The ordinary race suite replays the seed cases.

```sh
go -C activity/server test ./internal/origin -run '^$' -fuzz '^FuzzAssetLookup$' -fuzztime 15s
go -C activity/server test ./internal/origin \
  -run '^$' -fuzz '^FuzzEncodingNegotiation$' -fuzztime 15s
```

### Activity origin image

From the repository root, build the Linux AMD64 image with Docker Buildx and stage the matching
assets for the smoke test. Use an AMD64 engine or one with AMD64 emulation.

```sh
docker buildx build --platform linux/amd64 --load --tag botge-activity-origin:local \
  --file activity/server/Dockerfile .
sh scripts/activity/stage-activity-server.sh
BOTGE_ACTIVITY_IMAGE=botge-activity-origin:local go -C activity/server test -mod=readonly \
  ./cmd/activity-server -run '^TestActivityImage$' -count=1 -v
```

The Go Activity CI job stages assets and passes the source checks before building the image. Ready
releases that build an Activity candidate run the image smoke test during candidate qualification.
The smoke test checks startup without a key, unsigned health and page requests, the bytes of every
signed asset, and a clean exit on SIGTERM. It runs the final image as its configured nonroot user
with a read-only filesystem and a loopback port.

## Choosing checks

Start with the tests closest to the changed behavior, and include callers and shared contracts when
a change crosses boundaries. Skip unrelated suites for documentation-only edits. Run whole suites
and coverage gates when asked; CI runs them on every PR.

- **Rust source or toolchain:** `sh scripts/rust/check-rust.sh static`; add `dependencies` for
  manifests, features or dependencies, `coverage` for behavior or tests, and `miri` for pure logic
  it covers.
- **Activity or TypeScript tooling:** Run `npm run check:static` and `npm run test:coverage`. Add
  `npm run check:markup -w activity` for HTML, styles or build configuration.
- **iOS app:** `npm run check:ios` and `npm run test:ios:only` naming the `BotgeKitTests` and
  `BotgeTests` suites and UI test classes; add `npm run check:ios:analyze` when declarations change
  and `npm run test:ios:lockdown` for login, image or document changes.
- **Python helpers:** `.venv/bin/python scripts/quality/check_python.py`.
- **Control scripts or tooling tests:** `npm test -- --run --project Tooling`, and
  `npm run lint:shell` for shell scripts.
- **Workflows or composite actions:** `npm run lint:workflows`.
- **Reference snapshots:** `python3 .agents/scripts/cache_references.py --check`.

## Shell tests

`npm run test:shell` runs directly on Linux with Bats, Git, jq, kcov, and Python 3. On macOS, the
same command uses Docker with policy-capable Buildx to run the suite in a
[Docker Hardened Debian image](shell/Dockerfile). Buildx enforces the
[test image source policy](shell/Dockerfile.rego), and the test container runs without networking.

The [shell test runner](../scripts/quality/run_shell_tests.py) copies scripts into a temporary
workspace. Installer fixtures rebase host paths and simulate user IDs while preserving source line
numbers. Tests use fake commands for tools such as Docker and Xcode. The first pass uses the
intended shell for each script. The second uses Bash for kcov. CI requires at least 90% line
coverage in every tracked `.sh` file and fails on missing or empty reports. HTML reports are under
`coverage/shell/kcov/`.

- **Markdown or prose:** `npm run markdownlint` and Prettier.
- **Rego policy:** Regal.
- **Docker, Compose or deployment settings:** read the [control guide](../botge_control/README.md)
  and [production guide](../docs/PRODUCTION.md); use static validation and fixtures only.

`npm run run:ios -- --fixtures` launches the app on the simulator with offline fixtures. Measure iOS
performance changes on an iPhone with Lockdown Mode on, and Rust ones with the benchmarks below.

Routine checks never run setup, teardown, data import, deployment, pruning or live bot startup;
`npm start` builds and starts the stack and is not a check. Report the commands run, their results
and any checks not run with the reason, and keep static checks, fixture tests and live tests apart.
Fix failures within the task and rerun the affected checks; never lower a gate, skip a test, or
commit, push or deploy just to get a green result.

## Coverage gates

Every measured source file must meet its gate. Fix tests or source contracts; never lower a gate or
exclude executable code to pass.

| Language   | Per-file minimum                           | Report                         |
| ---------- | ------------------------------------------ | ------------------------------ |
| Rust       | 95% lines, branches, functions and regions | `coverage/rust/` (opt-in HTML) |
| TypeScript | 90% statements, branches, functions, lines | `coverage/typescript/`         |
| Python     | 90% lines and branches                     | `coverage/python/`             |
| Swift      | 90% lines, functions and regions           | `ios/DerivedData/*.xcresult`   |
| Go         | 90% statements                             | `coverage/go/`                 |
| Shell      | 90% lines                                  | `coverage/shell/kcov/`         |

Swift has no branch coverage; regions count every branch arm and closure instead. Swift coverage is
counted across the app, BotgeKit and the widget extension, and tests run serially so every test's
counts are kept. The widget extension's entry point and ActivityKit wiring are the only exemptions:
only the system runs them, and app tests render every view they show.

For the Rust HTML report, add `--html --output-dir coverage/rust` to the coverage scope. TypeScript
covers runtime files in repository tooling and the Activity. Declaration-only `.d.ts` files are
excluded. `npm run test:coverage -w activity` writes an Activity-only report to
`coverage/activity/`. Type checking validates `expectTypeOf` assertions; Vitest alone does not.

The iOS checks need macOS, Xcode 27 and the pinned tools from `npm run setup:ios`; the doctor
reports them as optional. SwiftUI views are covered by UI tests rather than the line gate.

### Lockdown Mode

The iOS app must work the same with Lockdown Mode on. `LockdownTests` simulates its restrictions in
unit tests on every run. `npm run test:ios:lockdown` runs every iOS test on a dedicated "iPhone 17e
Lockdown" simulator, created on first use. The iOS simulator has no Lockdown Mode switch, so the
script sets the `LDMGlobalEnabled` default that Lockdown Mode sets; WebKit honours it, so Discord's
sign-in sheet runs in Lockdown. `LockdownModeUITests` fails the plan if the setting is off.

Other system restrictions apply only on a device. Before a release, turn Lockdown Mode on in
Settings → Privacy & Security on an iPhone and repeat: log in, browse animated emotes, play a Guess
round, check the Live Activity, run a Shortcut and open the legal screens.

## Test layout

Rust unit tests live beside their modules; the [workspace guide](../crates/README.md) owns test
layout, fixtures and the dependency-policy test. `crates/botge/tests/rust_cli.rs` exercises the
compiled binary. A subprocess test checks the production panic hook, which exits with status 101.

Miri interprets the pure tests selected in `scripts/rust/check-rust-miri.sh`: Discord ID and voice
setting validation, Unicode shortcuts, layout arithmetic, and WebP timing. Network, database, audio
and FFmpeg paths stay in the coverage suite. Extend the filters when adding pure Rust tests.

`cargo-hack` checks feature combinations with development dependencies enabled, so `--locked` keeps
the committed graph. Optional `test-util` features must stay off in production dependencies.

Tooling tests cover lint, formatting, commit policy and the control protocol. Control tests use
command stubs instead of Docker and the control socket.

## Benchmarks

```sh
python3 .agents/scripts/compare_benchmarks.py record /tmp/before.json
python3 .agents/scripts/compare_benchmarks.py record /tmp/after.json
python3 .agents/scripts/compare_benchmarks.py compare /tmp/before.json /tmp/after.json
```

Record before and after a change. The helper reports median timings and rejects incompatible
metadata or changing sources. These are local microbenchmarks, not production latency.

## Git hooks

Pre-commit runs lint-staged with installed dependencies, so run `npm ci` first when needed. It
builds the Activity only when staged browser source, assets or build configuration change.
Post-merge prints reminders for `npm ci`, `npm --prefix tests/integration ci` or `uv sync --locked`
when their manifests change; it never installs anything.

## Live Discord testing

Live tests need explicit authorization and a separate Discord test application. Check for an
existing stack first, and register commands only on the test application.

Export `DISCORD_TOKEN` and `APP_ID` for the test application. Add `DISCORD_ACTIVITY_CLIENT_SECRET`
and `DISCORD_ACTIVITY_PUBLIC_KEY` to enable the local API on `127.0.0.1:3080`. Start with a fresh
database:

```sh
BOTGE_DATA_DIR="$(mktemp -d)" BOTGE_REGISTER_COMMANDS=true cargo run --locked
```

For the Activity, enable Proxy Authentication and use the test application's public key on both
origins. Set the test application's `/` mapping to the signed Go origin and `/botge-api` to the
isolated Rust backend. See [Discord URL mappings](../activity/README.md#discord-url-mappings).
Verify a cold launch through Discord, including the assets, catalog history, voice settings,
reconnects and status permissions. A direct unsigned request for origin content should return `401`.

Before a release, verify commands, guild catalog permissions and voice in Discord, and check
[resource usage](../docs/RESOURCE_USAGE.md) during an animated composition with voice connected.

### Compose integration

The Compose suite has its own package and lockfile. It needs Docker, `.env` and `botge.config.json`,
and logs a real bot into Discord. It builds an isolated stack with command registration disabled,
named volumes and a temporary nginx cache.

```sh
npm --prefix tests/integration ci
npm --prefix tests/integration run typecheck
BOTGE_TEST_COMPOSE=true npm --prefix tests/integration test
```
