# Python baseline audit

<!-- cspell:words Pylint absl -->

Reviewed 2026-11-14 against the [pinned sources](README.md). Scope: all shared/agent Python helpers,
unittest fixtures, root policy, editor configuration, hooks and CI. Evidence is source inspection
plus scoped checks; this is not a security proof or a claim that every upstream preference is a
mandatory rule. Reassess when adding a package, runtime service, concurrency or external API.

## Review matrix

| Reference       | Reviewed evidence / applicability                                     |
| --------------- | --------------------------------------------------------------------- |
| PEP 8           | Ruff enforces local layout, naming, imports and safe idioms.          |
| PEP 257         | Docstrings cover effects/failures; entry points provide help.         |
| Google 2.1      | Ruff ALL; substitutions and reasoned exceptions are explicit.         |
| Google 2.2–3    | Ordered imports; direct imports and script lookup are local choices.  |
| Google 2.4      | Explicit errors; validation rejects bools and numeric overflow.       |
| Google 2.5      | Immutable globals; mutable parser state belongs to instances.         |
| Google 2.6, 16  | Fixture closures are intentional; no late-bound production callbacks. |
| Google 2.7–11   | Simple iteration/expressions; no resource-owning generator API.       |
| Google 2.12     | No mutable parameter defaults.                                        |
| Google 2.13     | Plain fields/frozen dataclasses; no unnecessary properties.           |
| Google 2.14     | None is checked explicitly; ordinary emptiness uses truth tests.      |
| Google 2.17     | Class methods construct instances; parser hooks use override.         |
| Google 2.18     | No exposed threads or shared concurrent state; subprocess fixtures.   |
| Google 2.19     | Standard dataclasses/types; no custom metaclasses or import hooks.    |
| Google 2.20     | Python 3.15 makes legacy annotation future imports unnecessary.       |
| Google 2.21     | Strict types include hidden helpers; external JSON stays object.      |
| Google 3.1–6    | Formatter owns syntax/layout; 100 columns is deliberate.              |
| Google 3.7      | Explicit interpreter invocation; no executable shebang needed.        |
| Google 3.8      | Docstrings/pydoc; per-file copyright headers intentionally omitted.   |
| Google 3.10     | Single quotes, f-strings/joins; bounded CLI output is intentional.    |
| Google 3.11     | Context-managed resources; pathlib closes its own operations.         |
| Google 3.12     | No unresolved TODO placeholders in the reviewed Python surface.       |
| Google 3.13–14  | Grouped imports, one statement per line; direct imports documented.   |
| Google 3.15     | No redundant getters/setters.                                         |
| Google 3.16     | Importable snake_case files; conventional class and constant names.   |
| Google 3.17     | Guarded main; help/errors stop before probes/checks in tests.         |
| Google 3.18     | Long doctor code is declarative; concerns have separate helpers.      |
| Google 3.19     | Strict annotations, checked narrowing and explicit override checks.   |
| Typing          | Abstract input views/concrete results; precise unions remain typed.   |
| Modern typing   | Built-in generics, modern aliases/unions and stdlib typing APIs.      |
| Microsoft       | Locked dependencies; lint/types/tests, editor and hook integration.   |
| Azure language  | Naming, keyword-only flags, explicit errors/resources and types.      |
| Azure SDK scope | No published SDK, client protocols, cloud policies or API promise.    |
| Cache integrity | Reject empty/duplicate manifests, tampering and unsafe URL forms.     |

Concrete gaps closed: importable helper filenames, guarded CLI help/error handling, expanded I/O
contracts, checked override annotations, consistent finite-number validation, and unique/nonempty
cache manifests. Regression tests cover these boundaries and pydoc publication failures.

## Deliberate choices

- Four spaces, single quotes and 100 columns align with repository tooling; triple-double docstrings
  follow PEP 257. Ruff controls formatting instead of mixing multiple formatters.
- Ruff/Pyright replace the guides' alternative lint/type tools. unittest and Husky replace their
  pytest/absl/pre-commit examples. These substitutions do not imply identical rule coverage.
- No per-file copyright headers; preserve third-party notices. Direct imports and standalone script
  lookup are intentional; there is no installable public Python API or **all** compatibility
  promise.
- Precise unions and validation preserve strict typing. Do not adopt weaker Any recommendations or
  old syntax solely to match an upstream example.
- pydoc imports helpers but never invokes guarded entry points. Its build checks imports/output, not
  semantic documentation correctness, cross-reference validity or Rust-style doctests.

## Verification

Run `.venv/bin/python scripts/check_python.py` for lock consistency, Ruff, strict Pyright and
offline unittest fixtures. Optionally build docs separately with
`.venv/bin/python scripts/doc_python.py`; HTML is generated under ignored `target/pydoc/`. Verify
cached sources separately with `python3 .agents/scripts/cache_references.py --check`.

Python validation now enforces at least 90% lines and branches per helper file. Coverage includes
Python subprocesses and maps copied helper fixtures back to their source. Tests and generated files
are not measured as production helpers. Reports are generated in `coverage/python/`. No live bot,
deployment or production-data test is part of this audit.
