---
name: botge-validation
description:
  Select and run change-scoped checks for the MrewyOrg/Botge Rust bot, TypeScript Activity, and
  repository tooling. Use when validating Botge changes or preparing them for review; deployment and
  live Discord testing are separate workflows.
---

# Botge validation

Work from the Botge repository root. Identify it by its Git remote and project files, not a fixed
checkout path. If the current repository is unrelated, do not apply this workflow.

## Establish the scope

Read the current `AGENTS.md` and `tests/README.md`. Use `README.md` and `docs/ARCHITECTURE.md` when
architecture affects check selection. These files and package scripts own the current requirements;
prefer them over commands below if they drift.

Inspect staged, unstaged, and relevant untracked changes without discarding existing work. For a
requested PR or branch review, use the merge-base diff against the requested base. Separate failures
caused by the task from pre-existing failures where evidence permits.

Use `rust-toolchain.toml`, `.nvmrc`, package engines, and committed lockfiles. Reuse installed
dependencies when suitable; use `npm ci` when dependency installation is needed. Keep Socket
Firewall active. Use explicit RTK equivalents for supported reads, searches, and checks when
automatic rewriting is unavailable; do not double-wrap commands.

## Choose checks

Start with the affected behavior and its closest tests. Include callers and shared contracts when
changes cross boundaries. Run the appropriate broader checks before reporting completion; avoid
unrelated suites for documentation-only edits.

- **Rust source, Cargo dependencies, or toolchain:** `cargo fmt --all --check`;
  `cargo clippy --locked --all-targets -- -D warnings`; `cargo test --locked`
- **Rust public/internal contracts or Rustdoc:**
  `cargo doc --locked --no-deps --document-private-items`
- **Rust behavior or tests where coverage matters:** `sh scripts/check-rust-coverage.sh`; read
  `tests/README.md` for tools, thresholds, and FFmpeg prerequisites
- **Activity/browser/Worker TypeScript or shared JS tooling:** `npm run check` (shared static checks
  and both Vitest projects)
- **Activity runtime behavior or tests:** `npm run test:coverage -w activity` when assessing
  coverage
- **Activity HTML, styles, or build configuration:** `npm run check:markup -w activity`; inspect
  `activity/README.md` for additional style checks
- **Control scripts or shared tooling tests:** `npm test -- --run --project Tooling`;
  `npm run lint:shell` for shell changes
- **GitHub Actions:** `npm run lint:workflows`; read `.github/workflows/README.md` for workflow
  contracts
- **Markdown or prose:** `npm run markdownlint`; `npm run cspell`, scoped to changed files when
  supported and sufficient
- **Supported non-Rust formatting or Rego policy:** Check changed files with repository Prettier
  configuration or Regal, respectively
- **Docker/Compose/deployment configuration:** Read `botge_control/README.md`, `docs/PRODUCTION.md`,
  and relevant tooling tests; use static validation and fixtures

Check the current scripts before choosing a filtered test invocation. A full `npm run check` already
includes the Tooling and Activity tests; do not repeat them without a coverage requirement, new
change, or unresolved failure.

Provider and Discord behavior should use loopback fixtures; storage changes should use temporary
databases. Render tests need FFmpeg 9 or later with libwebp and FFprobe. Report missing
prerequisites rather than weakening a test or silently skipping it. Add tests for meaningful
observable behavior, not reversible prose/format changes or implementation mirrors.

## Operational boundaries

Routine validation does not execute setup, teardown, data import, deployment, pruning, or live bot
startup. In particular, `npm start` prunes Docker images and starts the stack; it is not a
validation command. Preserve local configuration, databases, volumes, and caches.

Run the opt-in Compose/Discord integration suite only within explicit live-test authorization.
Follow `tests/README.md`, check for an existing stack, and use a separate Discord test application.
A local check does not authorize command registration, production deployment, or any change to
deployment approval gates. Local CodeQL is optional, not a pre-push requirement.

Do not regenerate documentation PNG diagrams during validation. Builds and coverage commands may
create their normal ignored outputs; do not hand-edit or commit generated artifacts.

## Report and stop

Report the change scope, commands run, pass/fail results, and checks not run with concrete reasons.
Distinguish static validation, fixture tests, and actual live testing. Do not claim coverage or
deployment verification without running it.

Fix failures within the authorized task scope, then rerun the affected checks. Once required checks
pass, stop unless new changes or unresolved concerns justify more testing. Do not commit, push,
deploy, or alter unrelated code merely to obtain a green result.
