# Development helpers

Shared checks live here; agent-only reference and benchmark helpers remain in `.agents/scripts/`.
Rust check scopes and prerequisites are described in the [test guide](../tests/README.md).

- **`activity/`.** Activity origin asset staging and Go checks
- **`ios/`.** Xcode checks, simulator tests, Swift documentation, and Swift tool setup
- **`operations/`.** Compose and GitHub backups, the deploy client, and the backup LaunchAgent
  template
- **`quality/`.** Repository-wide shell, workflow, Python, and documentation checks
- **`rust/`.** Cargo checks, coverage, Miri, and the test FFmpeg installer
- **`setup/`.** Dev Container bootstrap and local prerequisite checks

## Python setup

Python is used for repository tooling. `.python-version` pins the interpreter; `pyproject.toml` owns
development dependencies, strict Ruff/Pyright policy, four-space indentation and single quotes.
Runtime helpers use only the standard library. Modern/experimental features need a concrete benefit
and verification against the pinned interpreter, editor and CI.

Create the ignored root `.venv/` and install locked tools with [uv](https://docs.astral.sh/uv/):

```sh
uv sync --locked
.venv/bin/python scripts/quality/check_python.py
.venv/bin/python scripts/setup/doctor.py
# Optional API documentation
.venv/bin/python scripts/quality/doc_python.py
```

Use the uv version required by `pyproject.toml`. It selects the pinned Python and installs it when
absent. `.venv/` keeps tools separate from system Python; recreate it rather than moving an existing
environment because its launchers contain absolute paths. VS Code uses this environment too.

`check_python.py` runs Ruff lint/format checks, strict Pyright and offline unittest suites for
shared and agent helpers. Staged Python files receive Ruff formatting/lint checks. Runtime helpers
and checks never start the bot. `doctor.py` only probes prerequisites; missing required tools fail
its exit status, while an unavailable Docker daemon is informational.

Pyright 1.1.414 automatically excludes hidden folders. The check derives a temporary configuration
with rebased paths from the root policy so `.agents` helpers are checked too. No duplicate policy is
tracked. VS Code's Pylance uses the same root policy; the workspace disables its automatic
hidden-folder exclusion.

After editing Python dependencies, run `uv lock`, review `uv.lock`, then `uv sync --locked` and the
checks. Local setup and CI use the same lockfile. Do not hand-edit lockfiles.

The optional pydoc build is separate from required local/CI checks. Generated HTML lives in ignored
`target/pydoc/`; open its `index.html` after the build. The build imports helpers, so keep module
initialization free of service startup and guard CLI entry points. It checks imports and missing
output, not documentation semantics or cross-references. The
[compact Python baseline](../.agents/references/python/README.md) records upstream guidance, local
choices and the audit.

Python validation enforces the [Python coverage gate](../tests/README.md#coverage-gates) in every
helper file. It includes Python subprocesses and normalizes copied fixtures. Tests and generated
files are outside the measured helper source set.

## Python guideline checklist

Ruff (`ALL`) and strict Pyright enforce most of PEP 8 and the Google guide. These need judgment;
each names its source in the cached guides listed in the
[Python reference index](../.agents/references/python/README.md), so read that one section when a
case is unclear.

- **Boundaries:** validate external JSON before narrowing types; reject Booleans where numbers are
  expected and non-finite numbers (Google 2.4, typing best practices).
- **Types:** accept abstract read-only inputs, return concrete results, and keep precise unions
  instead of `Any` (typing best practices, modern typing).
- **State:** no mutable globals; parser and runtime state belongs to instances. Prefer plain fields
  and frozen dataclasses to properties and getters (Google 2.5, 2.13, 3.15).
- **Resources:** context-managed files and processes, shell-free subprocesses, and bounded work
  (Google 3.11, Microsoft review).
- **Entry points:** guard `main`, and handle help and argument errors before any probe or side
  effect (Google 3.17).
- **Docstrings:** describe observable behavior, side effects, meaningful arguments and actual
  failure conditions; keep obvious helpers brief (PEP 257, Google 3.8).

## Shell and Python boundaries

The Activity, iOS, Rust, and setup entry points orchestrate platform commands in shell. The Rust and
iOS coverage filters live alongside the check scripts as jq files. Workflow linting uses Python for
the temporary checkout copy, text normalization, and subprocess exit status. Run the shell behavior
and coverage gates with `npm run test:shell`.
