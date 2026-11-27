# Q# references

Reviewed 2026-11-24 for the `/quantum-emote` Q# project (`quantum/`), its Python `qdk` sidecar
integration, and VS Code configuration. The [audit](AUDIT.md) maps the guides and compiler specs to
Botge's `qsharp.json` lint policy, source conventions, tests, and coverage checks. The
[manifest](../sources.json) pins every source URL and its SHA-256. Run
`python3 .agents/scripts/cache_references.py` to populate the ignored cache, or add `--check` to
verify the cached bytes offline.

## Source inventory

- [MicrosoftDocs/quantum-docs][quantum-docs] (`bdf5d69c09b3`): core Q# & QDK guides and the complete
  Q# Language Reference.
- [microsoft/qsharp][qsharp-repo] (`0e58afc2fbb3`): `qsharp.json` manifest schema, AST/HIR lint
  definitions, `qdk.test_utils`, telemetry opt-out (`QDK_PYTHON_TELEMETRY=none`), and VS Code
  extension configuration schema.

### Core Q# and QDK guides

- [Q# overview](../cache/qsharp-overview.md), [quickstart](../cache/qsharp-quickstart.md),
  [ways to work](../cache/qsharp-ways-to-work.md), and [Q# projects](../cache/qsharp-projects.md)
- [Q# callables in Python](../cache/qsharp-callables-python.md) and
  [QIR target profiles](../cache/qsharp-target-profiles.md)
- [Testing quantum code](../cache/qsharp-test-quantum-code.md) and
  [debugging quantum code](../cache/qsharp-debug-quantum-code.md)
- [Simulators overview](../cache/qsharp-simulators-overview.md),
  [VS Code simulator](../cache/qsharp-simulator-vscode.md),
  [circuit visualization](../cache/qsharp-visualize-circuits.md),
  [circuit diagrams overview](../cache/qsharp-circuit-diagrams-overview.md), and
  [VS Code QDK reference](../cache/qsharp-vscode-reference.md)

### Q# Language Reference subguides

- **Program structure:** [index](../cache/qsharp-lang-program-index.md),
  [attributes](../cache/qsharp-lang-program-attributes.md),
  [callables](../cache/qsharp-lang-program-callables.md),
  [comments](../cache/qsharp-lang-program-comments.md),
  [namespaces](../cache/qsharp-lang-program-namespaces.md),
  [specializations](../cache/qsharp-lang-program-specializations.md), and
  [type declarations](../cache/qsharp-lang-program-types.md)
- **Statements:** [index](../cache/qsharp-lang-stmt-index.md),
  [binding scopes](../cache/qsharp-lang-stmt-bindingscopes.md),
  [quantum memory management](../cache/qsharp-lang-stmt-memory.md), and
  [variables and reassignments](../cache/qsharp-lang-stmt-vars.md)
- **Type system:** [index](../cache/qsharp-lang-type-index.md),
  [immutability](../cache/qsharp-lang-type-immutability.md),
  [operations and functions](../cache/qsharp-lang-type-callables.md),
  [quantum data types](../cache/qsharp-lang-type-quantum.md),
  [singleton tuple equivalence](../cache/qsharp-lang-type-singleton.md),
  [subtyping and variance](../cache/qsharp-lang-type-subtyping.md),
  [type inference](../cache/qsharp-lang-type-inference.md), and
  [type parameterizations](../cache/qsharp-lang-type-params.md)
- **Expressions:** [index](../cache/qsharp-lang-expr-index.md),
  [arithmetic](../cache/qsharp-lang-expr-arithmetic.md),
  [bitwise](../cache/qsharp-lang-expr-bitwise.md),
  [call statements](../cache/qsharp-lang-expr-calls.md),
  [closures](../cache/qsharp-lang-expr-closures.md),
  [comparative](../cache/qsharp-lang-expr-comparative.md),
  [concatenation](../cache/qsharp-lang-expr-concat.md),
  [conditional branching](../cache/qsharp-lang-expr-branching.md),
  [conditional expressions](../cache/qsharp-lang-expr-cond.md),
  [conditional loops](../cache/qsharp-lang-expr-condloops.md),
  [conjugations](../cache/qsharp-lang-expr-conjugations.md),
  [contextual](../cache/qsharp-lang-expr-contextual.md),
  [copy and update](../cache/qsharp-lang-expr-copyupdate.md),
  [functor application](../cache/qsharp-lang-expr-functors.md),
  [item access](../cache/qsharp-lang-expr-itemaccess.md),
  [iterations](../cache/qsharp-lang-expr-iterations.md),
  [logical](../cache/qsharp-lang-expr-logical.md),
  [precedence and associativity](../cache/qsharp-lang-expr-precedence.md),
  [returns and termination](../cache/qsharp-lang-expr-returns.md), and
  [value literals](../cache/qsharp-lang-expr-literals.md)

### QDK compiler, linter, and VS Code specifications

- [Project manifest schema](../cache/qsharp-spec-manifest.rs)
- [AST lints](../cache/qsharp-spec-lints-ast.rs), [HIR lints](../cache/qsharp-spec-lints-hir.rs),
  and [lint groups](../cache/qsharp-spec-lint-groups.rs)
- [`qdk.test_utils`](../cache/qsharp-spec-test-utils.py),
  [`qdk.telemetry`](../cache/qsharp-spec-telemetry.py), and
  [VS Code extension configuration](../cache/qsharp-spec-vscode-package.json)

## Licenses

`MicrosoftDocs/quantum-docs` prose is licensed under [CC-BY-4.0](../cache/QSHARP-DOCS-LICENSE.txt)
and its code examples under [MIT](../cache/QSHARP-DOCS-CODE-LICENSE.txt). `microsoft/qsharp` specs
are licensed under [MIT](../cache/QSHARP-MIT-LICENSE.txt). Snapshots preserve upstream bytes
verbatim.

[quantum-docs]:
  https://github.com/MicrosoftDocs/quantum-docs/tree/bdf5d69c09b37b5446e86fda32f060e6beec864c
[qsharp-repo]: https://github.com/microsoft/qsharp/tree/0e58afc2fbb3fb8db806412b045acc0c675f8ce3
