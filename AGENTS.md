# Botge guidance

Rust Discord bot; Activity and Cloudflare Worker are TypeScript. Start with [README](README.md),
[architecture](docs/ARCHITECTURE.md), and the [source map](#source-map). User/hosting guides belong
in the [wiki](https://github.com/MrewyOrg/Botge/wiki); implementation contracts stay versioned here.

## Non-negotiable boundaries

- Preserve unrelated uncommitted work, credentials, local `.env`/`botge.config.json`, databases,
  `data/`, Docker volumes, and nginx cache. Never expose secrets in logs, tests, or commits.
- Edit source; do not hand-edit generated `target/`, `activity/dist/`, `coverage/`, or
  `node_modules/`.
- Live Discord tests require a separate test application and explicit authorization. Check existing
  stacks first; register commands only on that test application.
- Routine checks never execute deployment, setup, teardown, import, or pruning. Docker cleanup is
  manual. Preserve [approval-gated deployment](.github/workflows/README.md).
- Tooling/services must remain free: standard public-repository GitHub runners, no paid managed
  infrastructure, larger runners, storage, or trial-credit dependencies. Verify hosted limits and
  spending controls against the [cost policy](docs/PRODUCTION.md#cost-policy).
- Do not regenerate/edit documentation PNGs unless explicitly requested. Requested updates retain
  their dark style; verify labels/connections and align Mermaid sources/links with implementation.

## Rust references and implementation

Use the dated nightly and committed Cargo lockfile. Follow applicable Microsoft Pragmatic Rust, Rust
API, Rust Style, Design Patterns, and Undefined Behavior guidance. Start with the
[compact reference index](.agents/references/README.md); read relevant full sections on demand.
Snapshots retain source/version/license metadata and refresh manually. Summaries are navigation
aids, not replacements for authoritative rules. Cache other regularly reused references similarly.
If a needed snapshot is absent, run `python3 .agents/scripts/cache_references.py`; use `--check` for
offline integrity verification. Full snapshots are ignored by Git; compact indexes and pinned
source/checksum metadata stay tracked. Builds and test gates must not fetch them. Document justified
deviations in the reference README; do not claim blanket compliance.

- Keep two-space rustfmt indentation, conventional short names, small interfaces, explicit errors,
  and safe ownership. `unsafe_code` is forbidden. Use patterns only when they solve a real problem;
  experimental features need a concrete benefit, documented requirements and target verification.
- Start with Rustdoc contracts; inspect implementations for behavior, security, state, and
  concurrency. Describe boundary defaults, failure cases, side effects and actual panic/unsafe
  obligations. Use `//!` for modules, `///` for items and ordinary `//` for implementation notes.
  Fallible production helpers need accurate `# Errors`; use `# Panics`/`# Safety` only as
  applicable. Prefer intra-doc links and useful examples; label non-Rust code fences. Keep comments
  current and focused on final behavior, not design journals or compliance narratives.
- Cargo owns lint policy: deny `all`, `pedantic`, `nursery`, `cargo`; select compatible restriction
  lints individually. Prefer fulfilled `#[expect(..., reason = "...")]`. Test documentation
  expectations describe fixture errors/assertion panics; production helpers remain checked.
- Validate external input at boundaries; preserve provider opt-ins and verify membership/permissions
  before writes. Bound requests/rendering. Keep Discord/Axum in adapters and redb transactions in
  storage; run blocking database work off the async executor. Benchmark performance changes.
- Test observable behavior, especially denial, concurrent updates and reconnects. Within each test
  file, put imports and local fixtures/helpers before related scenario groups; keep setup, action
  and observable assertions readable. Private unit tests live beside modules in `tests.rs`;
  executable integration suites live under `tests/`.
- Align runtime defaults, schemas, examples and documentation. New environment options go in
  `.env.example`. Keep dependencies, CI, Docker, tests and docs aligned when modernizing.

## TypeScript conventions

Follow `.nvmrc`, package engines and committed npm locks; install with `npm ci`. Use two spaces,
single quotes, semicolons and ESM relative imports ending in `.ts`. Group imports by
Node/dependencies/project; keep type-only imports beside their modules.

Prefer readonly data: flat `readonly` properties, `readonly T[]`, readonly tuples, `ReadonlyMap`/
`ReadonlySet`; use `ts-essentials` `DeepReadonly` for nested snapshots. This includes parameters,
returns, locals, tests and tooling. Keep construction/reordering collections and DOM/SDK
capabilities mutable when needed. Express invariants with utility types/correlated unions;
assertions never replace validation.

Keep the single `@packageDocumentation` comment in `activity/src/index.ts`. Other overviews use
ordinary comments. Attach TSDoc directly to declarations; include applicable parameter/return/error/
generic/remarks/example/reference tags. Use code spans for built-in exception names. No Better
Comments markers; preserve Rust's native `//!` scope.

## Validation

Python tooling uses `.python-version`, the root `.venv`, and committed `uv.lock`. Run
`uv sync --locked` for setup and `.venv/bin/python scripts/check_python.py` for strict Ruff/Pyright
and tests. Generate pydoc only when API documentation is needed. `pyproject.toml` owns policy;
follow the [helper guide](scripts/README.md): four spaces, single quotes, typed/validated
boundaries. Modern and experimental Python features need a concrete benefit and verification against
the pinned interpreter, editor and CI. Runtime helpers stay standard-library-only.

Follow applicable PEP 8/257, Google Python, Python typing and Microsoft review guidance through the
[compact Python references](.agents/references/python/README.md), including documented exceptions.

Use `.venv/bin/python scripts/doctor.py` after environment changes or prerequisite failures. For
Rust performance work, `.agents/scripts/compare_benchmarks.py` records and compares timings; see the
[agent helper guide](.agents/scripts/README.md). Use helpers for their relevant scope.

Python validation enforces at least 90% line and branch coverage in every helper file. It includes
Python subprocesses and normalizes copied fixtures; reports are generated in `coverage/python/`.
Tests and generated files are outside the measured helper source set.

Use the [test guide](tests/README.md) and
[validation skill](.agents/skills/botge-validation/SKILL.md) for scoped checks. Report failures and
unavailable checks. Coverage already executes tests; avoid duplicating successful suites without a
new change or unresolved concern.

Before opening or updating a PR, validate its title with
`printf '%s\n' "$PR_TITLE" | npx --no-install commitlint` and its full commit range with
`npx --no-install commitlint --from="$BASE_SHA" --to=HEAD --verbose`. Use the current target-branch
SHA for `BASE_SHA`; commit hooks check individual commits but do not validate the PR title or
earlier commits.

- Rust: `sh scripts/check-rust.sh static` checks formatting, Clippy, private Rustdoc/doctests,
  feature combinations and unused dependencies. Select `coverage`, `miri`, or `bench` explicitly for
  those scopes. Use filtered `cargo test --locked` for focused iteration. Miri covers pure Rust;
  normal coverage retains native integrations/stress fixtures. Pinned tools/setup: test guide.
- Rust coverage: at least 95% branches, lines, functions and regions in every source file. Fixtures
  use loopback providers/Discord, temporary redb and FFmpeg 9+ with libwebp/FFprobe.
- TypeScript: `npm run check` or `npm run check:static` plus `npm run test:coverage` when coverage
  applies. Enforce 90% statements/branches/functions/lines per runtime source file. Activity-only:
  `npm run test:coverage -w activity`; markup: `npm run check:markup -w activity`. Run Activity
  builds/tests sequentially: builds can replace the HTML module mocked by Worker tests.
- Docs/tooling: Prettier, `npm run markdownlint`, `npm run cspell`, `npm run lint:shell`,
  `npm run lint:workflows`; Regal for Rego.
- Optional local CodeQL: use CI's config/suites; databases in `.github/codeql/database/`, reports in
  `.github/codeql/output/`. Keep generated artifacts uncommitted; CodeQL is not a pre-push gate.

## Source map

- `crates/botge/src/main.rs`: configuration, lifecycle, health and concrete dependency wiring.
- `crates/botge-domain`: shared records, canonical IDs, validation, matching and catalog rules.
- `crates/botge-storage`: redb schema and synchronous transactions; no adapter dependencies.
- `crates/botge-emotes`: providers, snapshots, 7TV events and bounded rendering; no persistence.
- `crates/botge-app`: authorization, state coordination, batch mutations and composition admission.
- `crates/botge-discord`: commands, gateway and Discord access capability implementation.
- `crates/botge-activity`: Axum routes, signed proxy input and HTTP response mapping.
- `crates/botge-voice`: Songbird reconciliation through the application settings-source capability.
- `crates/botge-test-support`: development-only loopback, media and log fixtures. Keep fixture
  features disabled on production dependencies. The [workspace guide](crates/README.md) owns the
  dependency policy; `crates/botge/tests/architecture.rs` enforces it.
- `activity/`: browser/Worker [workspace guide](activity/README.md). Root Vitest runs Activity and
  tooling projects. Python helpers use the root setup and shared checks in `scripts/`.
- `Dockerfile`: DHI Rust workspace image; `compose.yaml`: bot/nginx; `compose.build.yaml`: local
  build; `compose.activity.yaml`: loopback API. Read [control guide](botge_control/README.md) before
  deployment tooling changes.
