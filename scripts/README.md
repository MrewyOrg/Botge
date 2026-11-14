# Development helpers

Shared checks live here; agent-only reference and benchmark helpers remain in `.agents/scripts/`.
Rust check scopes and prerequisites are described in the [test guide](../tests/README.md).

## Python setup

Python is used for repository tooling. `.python-version` pins the interpreter; `pyproject.toml` owns
development dependencies, strict Ruff/Pyright policy, four-space indentation and single quotes.
Runtime helpers use only the standard library. Modern/experimental features need a concrete benefit
and verification against the pinned interpreter, editor and CI.

Create the ignored root `.venv/` and install locked tools with [uv](https://docs.astral.sh/uv/):

```sh
uv sync --locked
.venv/bin/python scripts/check_python.py
.venv/bin/python scripts/doctor.py
# Optional API documentation
.venv/bin/python scripts/doc_python.py
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

Python validation enforces at least 90% line and branch coverage in every helper file. It includes
Python subprocesses and normalizes copied fixtures; reports are generated in `coverage/python/`.
Tests and generated files are outside the measured helper source set.

## Rust coverage validation

`check-rust-coverage.sh` keeps its short jq filter: it checks four coverage categories per file and
rejects reports without branch measurements. jq is already needed by repository and deployment
scripts. Moving this filter to Python would add Python setup to Rust-only CI checks without a
meaningful speed or dependency saving. Reconsider if report validation grows enough to benefit from
typed parsing, detailed schema diagnostics and dedicated fixtures.
