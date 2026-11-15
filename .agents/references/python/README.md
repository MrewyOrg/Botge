# Python references: compact baseline

Reviewed 2026-11-14. Read this index first; load only relevant cached sections. These are original
navigation summaries, not substitutes for upstream rules. [Audit and exceptions](AUDIT.md) describe
Botge's application. Full snapshots are ignored; source URLs, revisions and SHA-256 hashes are
tracked in the [manifest](../sources.json). From the repository root, run
`python3 .agents/scripts/cache_references.py` if needed, or add `--check` for offline verification.
Builds and CI never fetch reference snapshots. Refresh manually after reviewing upstream changes.

## Sources

- [PEP 8](../cache/python-pep8.rst): [official style guide](https://peps.python.org/pep-0008/).
- [PEP 257](../cache/python-pep257.rst): [docstring conventions](https://peps.python.org/pep-0257/).
- [Google](../cache/python-google.md):
  [language/design/style guidance](https://google.github.io/styleguide/pyguide.html).
- [Typing](../cache/python-typing.rst) and [modernization](../cache/python-modern-typing.rst):
  [official typing guidance](https://typing.python.org/en/latest/reference/best_practices.html).
- [Microsoft review](../cache/python-microsoft.md): [Engineering Fundamentals
  Playbook][microsoft-review].
- Azure SDK [design](../cache/python-azure-design.md) and
  [implementation](../cache/python-azure-implementation.md):
  [official library guidance](https://azure.github.io/azure-sdk/python_design.html), applied
  selectively.

## Working rules

Use typed boundaries, explicit errors, small interfaces and ordinary Python constructs. Validate
external JSON before narrowing types; use abstract read-only views where appropriate. Prefer
built-in generics, `X | None`, `type` aliases and `@override` on the pinned Python. Keep imports
side-effect free, entry points guarded, resources scoped, subprocesses shell-free and work bounded.
Document observable behavior, side effects, meaningful arguments and actual failure conditions; keep
obvious helpers brief. Test behavior and failures. Run the shared strict checks; generate pydoc when
API documentation is useful.

Botge uses four spaces, single quotes, 100 columns, Ruff, strict Pyright, unittest, Husky and uv.
The audit records differences from upstream tool, formatting, import and header preferences. These
are CLI tools, not an Azure SDK or published Python library. SDK packaging, cloud policies,
compatibility matrices and service-client protocols have no current surface here. New language
features require a concrete benefit and verification against interpreter, editor and CI.

## Provenance and licenses

All snapshots retain original bytes and notices; no upstream text was edited. Revisions are pinned:

| Publisher     | Revision       | License             |
| ------------- | -------------- | ------------------- |
| Python PEPs   | `5595f77d7d9c` | Public domain       |
| Google        | `a9c5f82b1981` | CC BY 3.0           |
| Python Typing | `6d2f52c48db0` | PSF license         |
| MS Playbook   | `016770e43d8a` | CC BY 4.0; MIT code |
| MS Azure SDK  | `237194b479a4` | MIT                 |

License files: [Google](../cache/PYTHON-GOOGLE-LICENSE.txt),
[Typing](../cache/PYTHON-TYPING-LICENSE.txt),
[Microsoft text](../cache/PYTHON-MICROSOFT-LICENSE.txt),
[Microsoft code](../cache/PYTHON-MICROSOFT-CODE-LICENSE.txt),
[Azure](../cache/PYTHON-AZURE-LICENSE.txt). Each PEP retains its public-domain declaration.

[microsoft-review]:
  https://microsoft.github.io/code-with-engineering-playbook/code-reviews/recipes/python/
