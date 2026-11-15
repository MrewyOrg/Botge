# Agent helpers

Shared Python setup, strict checks and the environment doctor are documented in the
[development helper guide](../../scripts/README.md). Agent-only helpers remain here:

- `cache_references.py` downloads absent, pinned reference snapshots and verifies hashes; `--check`
  verifies the existing cache offline.
- `compare_benchmarks.py` records repeated native measurements and compares compatible recordings
  without switching revisions or starting the bot.

Runtime helpers use the standard library. Full reference snapshots remain ignored; compact indexes
and source/checksum metadata stay tracked.
