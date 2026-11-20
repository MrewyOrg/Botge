# Tests and checks

This guide owns check commands, coverage gates, toolchains and prerequisites. Other documents link
here instead of repeating them. Run commands from the repository root. The
[validation skill](../.agents/skills/botge-validation/SKILL.md) chooses checks for a given change.

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

`.venv/bin/python scripts/doctor.py` reports missing prerequisites without installing anything.

## Checks

| Command                                    | Covers                                              |
| ------------------------------------------ | --------------------------------------------------- |
| `sh scripts/check-rust.sh static`          | rustfmt, Clippy, private Rustdoc and doctests       |
| `sh scripts/check-rust.sh dependencies`    | feature combinations, unused dependencies (slowest) |
| `sh scripts/check-rust.sh coverage`        | all Rust tests and the per-file coverage gate       |
| `sh scripts/check-rust.sh miri`            | pure Rust tests (after `cargo miri setup`)          |
| `sh scripts/check-rust.sh bench`           | nightly libtest benchmarks                          |
| `npm run check:static`                     | Types, ESLint (TS and HTML), Stylelint, unused code |
| `npm run test:coverage`                    | Activity, Worker and tooling tests + gate           |
| `npm run check:markup -w activity`         | Activity build, HTML validation                     |
| `npm run markdownlint`, `npm run cspell`   | Markdown and spelling                               |
| `npm run lint:shell`                       | ShellCheck                                          |
| `npm run lint:workflows`                   | actionlint, including composite actions             |
| `.venv/bin/python scripts/check_python.py` | Python helpers (see the helper guide)               |
| `npm run check:ios`                        | SwiftFormat lint and strict SwiftLint               |
| `npm run check:ios:analyze`                | SwiftLint analyzer: unused declarations and imports |
| `npm run test:ios`                         | iOS unit and UI tests, Swift coverage gate          |
| `npm run test:ios:lockdown`                | Lockdown test plan (simulator in Lockdown Mode)     |
| `npm run test:ios:only -- EmoteLinkTests`  | Named iOS suites or tests, one result line per test |

CI runs the same commands. Coverage commands already run their tests, so don't repeat a passing
suite. For focused iteration, use a filtered `cargo test --locked`, Vitest or
`npm run test:ios:only` run.

Run Activity builds and tests one at a time: Worker entry tests mock the generated HTML module, and
a concurrent build can replace it.

## Coverage gates

Every measured source file must meet its gate. Fix tests or source contracts; never lower a gate or
exclude executable code to pass.

| Language   | Per-file minimum                           | Report                         |
| ---------- | ------------------------------------------ | ------------------------------ |
| Rust       | 95% lines, branches, functions and regions | `coverage/rust/` (opt-in HTML) |
| TypeScript | 90% statements, branches, functions, lines | `coverage/typescript/`         |
| Python     | 90% lines and branches                     | `coverage/python/`             |
| Swift      | 90% lines, functions and regions           | `ios/DerivedData/*.xcresult`   |

Swift has no branch coverage; regions count every branch arm and closure instead. Swift coverage is
counted across the app, BotgeKit and the widget extension, and tests run serially so every test's
counts are kept. The widget extension's entry point and ActivityKit wiring are the only exemptions:
only the system runs them, and app tests render every view they show.

For the Rust HTML report, add `--html --output-dir coverage/rust` to the coverage scope. TypeScript
covers runtime files in repository tooling, the Activity and its Worker; declaration-only `.d.ts`
files are excluded. `npm run test:coverage -w activity` writes an Activity-only report to
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

Miri interprets the pure tests selected in `scripts/check-rust-miri.sh`: Discord ID and voice
setting validation, Unicode shortcuts, layout arithmetic, and WebP timing. Network, database, audio
and FFmpeg paths stay in the coverage suite. Extend the filters when adding pure Rust tests.

`cargo-hack` checks feature combinations with development dependencies enabled, so `--locked` keeps
the committed graph. Optional `test-util` features must stay off in production dependencies.

Tooling tests cover lint, formatting, spelling, commit policy and the control protocol. Control
tests use command stubs instead of Docker and the control socket.

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

For the Activity, enable proxy authentication, build with `VITE_ENABLE_ACTIVITY_SETTINGS=true`, and
map the test application's API URL to this backend as described in the
[Activity hosting guide](https://github.com/MrewyOrg/Botge/wiki/Activity). Check startup, channel
selection and clearing, reconnects, and status permissions on a test server.

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
