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

Read the current `AGENTS.md` and `tests/README.md`; the test guide and package scripts own the
current commands and gates. Use `docs/ARCHITECTURE.md` when architecture affects check selection.

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

- **Rust source or toolchain:** `sh scripts/check-rust.sh static`
- **Rust manifests, features, or dependencies:** also `sh scripts/check-rust.sh dependencies`
- **Rust behavior or tests:** `sh scripts/check-rust.sh coverage`; it runs the tests, so don't
  repeat plain `cargo test`
- **Pure Rust logic covered by Miri:** `cargo miri setup`, then `sh scripts/check-rust.sh miri`
- **Activity, Worker, or shared TypeScript tooling:** `npm run check:static` and
  `npm run test:coverage`; `npm run check` when coverage is outside the change
- **Activity HTML, styles, or build configuration:** `npm run check:markup -w activity`, plus
  `npm run eslint` for HTML and `npm run stylelint` for SCSS
- **Python tooling:** `.venv/bin/python scripts/check_python.py`
- **Control scripts or tooling tests:** `npm test -- --run --project Tooling`; `npm run lint:shell`
  for shell changes
- **GitHub Actions or composite actions:** `npm run lint:workflows`
- **Markdown or prose:** `npm run markdownlint` and `npm run cspell`, scoped to changed files when
  supported
- **Other formatting or Rego policy:** repository Prettier configuration or Regal
- **Docker, Compose, or deployment configuration:** read `botge_control/README.md` and
  `docs/PRODUCTION.md`; use static validation and fixtures

The test guide lists the coverage gates and prerequisites. Inspect individual files and missing
paths, not only totals. Add behavior tests or fix source contracts; never lower a gate or exclude
executable code. Report missing prerequisites instead of weakening or skipping a test.

For modernization, verify features against the pinned nightly, the stable `rust-version` for
production code, and the configured TypeScript, Node, bundler and browser targets. Build output
alone does not prove runtime support. Provider and Discord behavior use loopback fixtures; storage
uses temporary databases. Test meaningful observable behavior, not prose or implementation mirrors.

## Operational boundaries

Routine validation does not execute setup, teardown, data import, deployment, pruning, or live bot
startup. In particular, `npm start` builds and starts the stack; it is not a validation command.
Docker cleanup remains manual. Preserve local configuration, databases, volumes, and caches.

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
