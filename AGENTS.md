# Botge guidance

The Discord bot uses Rust, the Activity uses TypeScript and Go, and the iOS app uses SwiftUI. Find
code through the [source map](#source-map). Read [architecture](docs/ARCHITECTURE.md) when a change
crosses crates. User and hosting guides belong in the
[wiki](https://github.com/MrewyOrg/Botge/wiki).

Formatters, linters and compilers enforce style, documentation and safety rules in every language
(rustfmt and Clippy, Prettier and ESLint, SwiftFormat and SwiftLint, Ruff and Pyright). Fix their
findings instead of silencing them; when an exception is justified, use a reasoned `#[expect]` or a
commented `swiftlint:disable:next` and record it in the language's
[reference index](.agents/references/README.md). The rules below are the ones tools cannot check;
[crates/AGENTS.md](crates/AGENTS.md) and [ios/AGENTS.md](ios/AGENTS.md) add the Rust and iOS rules
and guideline checklists.

## Boundaries

- Preserve unrelated uncommitted work, credentials, local `.env`/`botge.config.json`, databases,
  `data/`, Docker volumes and the nginx cache. Never expose secrets in logs, tests or commits.
- Do not hand-edit generated `target/`, `activity/dist/`, `coverage/` or `node_modules/`.
- Live Discord tests need a separate test application and explicit authorization. Check for an
  existing stack first; register commands only on that test application.
- Routine checks never deploy, set up, tear down, import or prune. Docker cleanup is manual. Keep
  [approval-gated deployment](.github/workflows/README.md).
- Tooling and services stay free: standard public-repository GitHub runners, no paid infrastructure,
  larger runners, storage or trial credits. Check limits against the
  [cost policy](docs/PRODUCTION.md#cost-policy).
- Do not regenerate or edit documentation PNGs unless asked. Requested updates keep their dark
  style, and Mermaid sources and links match the implementation.

## TypeScript

- Add `as const` to every literal constant and literal data value, including inline loop arrays
  (`const PAGE_SIZE = 24 as const;`); skip collections that are mutated, and give a parameter whose
  default is a constant its wider type.
- Prefer readonly data in parameters, returns, locals, tests and tooling: `readonly` properties and
  arrays, `ReadonlyMap`/`ReadonlySet`, and `ts-essentials` `DeepReadonly` for nested snapshots. Keep
  construction collections and DOM or SDK objects mutable when needed. Type assertions never replace
  validation.
- Keep the single `@packageDocumentation` comment in `activity/src/index.ts`.

## Validation

The [test guide](tests/README.md) owns check commands, coverage gates, prerequisites and which
checks a change needs. Run targeted tests for the changed code; run whole suites or coverage gates
only when asked, since CI runs them. Report failures and checks you could not run. Python helpers
follow the [helper guide](scripts/README.md); run `.venv/bin/python scripts/setup/doctor.py` after
environment changes.

## Pull requests and issues

Changes reach `main` only through same-repository PRs from `dev`; Dependabot targets `dev`. Before
opening or updating a PR, validate its title with
`printf '%s\n' "$PR_TITLE" | npx --no-install commitlint` and its commits with
`npx --no-install commitlint --from="$BASE_SHA" --to=HEAD --verbose`, using the current
target-branch SHA.

Label every PR by area (`rust`, `swift`, `docker`, `github_actions`, `documentation`) and kind
(`enhancement`, `bug`); labels trigger no workflow. Give every issue an issue type (Task, Bug or
Feature) and labels, set the organization fields Priority and Effort through
`repos/MrewyOrg/Botge/issues/<number>/issue-field-values` (values are option names), and add it to
the MrewyOrg project "Botge" (#2) with Status and Phase. Auto-assign sets assignees.

## Source map

- `crates/botge/src/main.rs`: configuration, lifecycle, health and dependency wiring.
- `crates/botge-domain`: shared records, canonical IDs, validation, matching and catalog rules.
- `crates/botge-storage`: redb schema and synchronous transactions; no adapter dependencies.
- `crates/botge-emotes`: providers, snapshots, 7TV events and bounded rendering; no persistence.
- `crates/botge-app`: authorization, state coordination, batch mutations and composition admission.
- `crates/botge-discord`: commands, gateway and Discord access.
- `crates/botge-activity`: Axum routes, signed proxy input and HTTP response mapping.
- `crates/botge-voice`: Songbird reconciliation through the application settings source.
- `crates/botge-quantum`: quantum emote register budget, pool planner and Q# sidecar client.
- `crates/botge-test-support`: development-only loopback, media and log fixtures; keep its features
  off production dependencies.
- Rust rules for every crate above: [crates/AGENTS.md](crates/AGENTS.md).
- `ios/`: SwiftUI app ([guide](ios/README.md), [rules](ios/AGENTS.md)); `BotgeKit` holds auth, API
  and image logic and calls the bearer-only `/app/v1` routes that `BOTGE_APP_API=true` enables.
- `activity/`: browser code ([guide](activity/README.md)). Root Vitest runs Activity and tooling
  tests.
- `activity/server/`: signed Go Activity origin ([rules](activity/server/AGENTS.md)); the test guide
  owns staging and coverage commands.
- `quantum/`: Q# entanglement circuit and CPU-only FastAPI sidecar
  ([setup and VS Code guide](quantum/README.md), [rules](quantum/AGENTS.md),
  [mathematical specification](quantum/docs/botge-quantum.tex)).
- `quantum/proofs/`: proofs of the specification: `lean/` (Lean 4, `lake exe audit_axioms`),
  `symbolic/` (SymPy/Z3) and `certificate/` (the `botge-quantum-certificate` simulator, the one
  workspace crate outside `crates/`); `scripts/quantum/` holds `check_qsharp.py`, the `.tex`
  constant verifier and `check_proofs.py`, which runs the Lean, symbolic, certificate and `.tex`
  checks ([guide](quantum/README.md)).
- `scripts/` and `.agents/scripts/`: Python and shell helpers ([helper guide](scripts/README.md)).
- `Dockerfile`, `compose.yaml` (bot and nginx), `compose.build.yaml` (local build),
  `compose.activity.yaml` (loopback API) and `compose.quantum.yaml` (quantum sidecar); read the
  [control guide](botge_control/README.md) before changing deployment tooling.
