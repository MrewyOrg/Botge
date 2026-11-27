# Botge quantum sidecar

CPU-only Q# entanglement circuit and FastAPI sidecar (`compose.quantum.yaml`) for Botge. It samples
the pure-quantum Ising-Rx circuit of the [specification](docs/botge-quantum.tex) (Definition 3.1)
with `EntangleStack` under `TargetProfile.Base`, `QDK_PYTHON_TELEMETRY=none` and a 16-qubit ceiling:
no classical randomness, mid-circuit branching or style register.

## HTTP contract

- `GET /healthz`: unauthenticated `{"status": "ok", "backend": "cpu"}`.
- `POST /v1/entangle`: optional `Authorization: Bearer <BOTGE_QUANTUM_SECRET>`, checked in constant
  time. Both sides ignore whitespace around the secret, and a blank secret disables authentication.
  The strict JSON body takes `base_pool_size` (`2..=1024`), `overlay_pool_size` (`2..=128`) and
  `steps` (`1..=6`, default `3`). Pools needing more than 16 qubits (`n = ceil(log2 M)`, for example
  `513` and `65` need `10 + 7`) return HTTP 422.
- The response is
  `{"mode": "entangle", "qubits": n_b + n_o, "base_index": int, "overlay_index": int}`, decoded
  little-endian from the measured `(Result[], Result[])`.
- Rejection sampling runs single shots until one lands inside both pools (Theorem 5.1): powers of
  two always accept the first shot, the acceptance probability is above 1/4, and after 256 rejected
  shots (probability below `1.05e-32`) the request fails with HTTP 503
  `rejection sampling budget exhausted`. There is no classical fallback.

## Bot integration

Setting `BOTGE_QUANTUM_URL` (an `http` or `https` URL without a query or fragment, and optionally
`BOTGE_QUANTUM_SECRET`; see `.env.example`) registers `/quantum-emote` with options `steps`
(`1..=6`, default `3`) and `size` (provider scale `1..=4`, default `2`). Out-of-range values are
rejected, never clamped. The [`botge-quantum`](../crates/botge-quantum/src/lib.rs) crate:

- splits the guild catalog into base and overlay pools (repeated IDs and blank names dropped), sorts
  each by `(name.to_ascii_lowercase(), id)` and keeps the prefixes allowed by Proposition 2.1, so a
  given catalog always maps indices to the same emotes;
- refuses fewer than two base or two overlay emotes before calling the sidecar;
- sends one request with a 3-second deadline and at most four in flight, decodes the response
  strictly and checks `qubits` and both indices against the plan;
- names the circuit width, steps and both emotes in the reply caption.

The bot then renders the pair without stretching through the normal composition admission. Sidecar
failures, timeouts and invalid answers are explained in an ephemeral followup and counted in
`botge_quantum_samples_total{outcome}` on `/metrics`; nothing is retried or drawn classically.
Without `BOTGE_QUANTUM_URL`, the command is not registered and command registration removes it.

## Layout

- `qsharp.json`: Q# project manifest (`"targetProfile": "base"` and schema-valid lints at
  `"error"`).
- `src/BotgeQuantum.qs`: implicit-namespace `BotgeQuantum` module exporting `ApplyIsingRxCircuit`
  (`H`, `n_b n_o` commuting `Rzz` and `Rx(-pi / 4)`, at most 96 gates) and `EntangleStack`
  (`MResetEachZ` on both registers).
- `src/BotgeQuantumTests.qs`: `@Test()` suite checking `EntangleStack` register widths at both
  16-qubit maxima and the smallest and most lopsided sizes. Every test compiles and runs under Base,
  so VS Code's Testing view lists them all.
- `tests/test_circuit.py`: state-vector tests of `ApplyIsingRxCircuit` under Base: `Adj` and `Ctl`
  round trips across depths and widths (both 16-qubit maxima included), the exact Corollary 4.4
  amplitudes and Born law, complement invariance, and entanglement through the reduced-state purity.
  Base rejects Q# assertions on qubit state (`CheckAllZero` is a dynamic bool), so these read
  `dump_machine()` into NumPy (dev dependency group), as Microsoft's
  [state-testing sample](https://github.com/microsoft/qdk/tree/main/samples/testing/states) does. It
  also parses every printed metric of Table 1 and each `\approx` estimate of Proposition 5.2 from
  `docs/botge-quantum.tex` and requires the simulated Born law to round to it, which pins the
  angles, gate order, bit order and decoding that the structural checks above would not.
- `server.py`: FastAPI sidecar using a dedicated single worker thread for QDK `Interpreter` thread
  affinity, `threading.Lock`, constant-time Bearer auth, `BATCH_SHOTS=1` / `MAX_BATCHES=256`, and
  strict `Result` decoding that rejects `bool`, `int` and `Loss` values.
- `tests/test_server.py`: unit and live-Q# sidecar test suite.
- `Dockerfile`, `Dockerfile.rego`, and `Dockerfile.dockerignore`: digest-pinned Debian Docker
  Hardened Python/uv image (`USER 65532:65532`, read-only root compatible) and source policy.
- `proofs/`: Phase 0 proofs of the [specification](docs/botge-quantum.tex), outside the sidecar
  image (`Dockerfile.dockerignore` allowlists only the runtime files):
  - `lean/`: Lean 4 + Mathlib formalization (`BotgeLean`), strict `lakefile.toml`, and the
    `audit_axioms` executable that rejects every non-standard axiom.
  - `symbolic/`: SymPy and Z3 checks (dev dependency group). Each `symbolic_*.py` module covers one
    section of the specification and `verify_symbolic.py` runs them in order; `tests/` checks each
    module, including that the Z3 checks find counterexamples to deliberately broken claims.
    `scripts/quality/check_python.py` lints, type-checks and covers it with the other helpers.
  - `certificate/`: the `botge-quantum-certificate` workspace crate. Its library simulates the
    circuit in rigorous interval arithmetic: every value is an enclosure of the exact real, with
    one-ulp outward rounding and series-based `sin`, `cos`, `log₂` and `2^x` whose truncation error
    is bounded. Unit tests check the enclosures and the simulator against the gate-level circuit,
    the Corollary 4.4 closed forms and the widths `crates/botge-quantum` produces;
    `tests/certificate_414.rs` proves Proposition 5.2 and Table 1 across all 414 admissible
    configurations, including that each extreme is attained only at its stated configuration, and
    `tests/lean_identities.rs` checks the simulator against the Lean-proved complement invariance,
    uniform bits, `eq:bitwise-corr` and `eq:intra-corr` in every configuration.
- `../scripts/quantum/`: Q# and proof check scripts, tested with fake QDK contexts and the other
  helpers by `scripts/quality/check_python.py`:
  - `check_qsharp.py`: audits `qsharp.json`, enforces static lint rules, runs `lint-qsharp.ts`,
    compiles with zero Q# warnings, compiles `EntangleStack` to Base QIR and checks the Proposition
    3.1 gate tally, runs `qdk.test_utils.run_tests()` under Base, checks every `Fact` guard, and
    enforces 100% Q# statement and branch coverage (`quantum` extra).
  - `lint-qsharp.ts`: the Python `qdk` package compiles Q# but never runs its linter, so this Node
    script runs the language service VS Code uses (the `qsharp-lang` npm package, pinned to the
    `qdk` version) under Base and again under Unrestricted, so any `@Config(Unrestricted)` code is
    linted too, and fails on any error or warning, such as `needlessParens`. Vitest covers it in
    `tests/tooling/lint-qsharp.test.ts`.
  - `verify_tex_constants.py`: proves the printed decimals round to their printed digits (mpmath
    interval arithmetic), checks specification scope and `.tex`-to-Lean label traceability, and
    requires the certificate's Table 1 rows to equal the `.tex` table and its checks to cover every
    number and configuration of Proposition 5.2.
  - `check_proofs.py`: runs every stage; `--only lean|symbolic|rust|tex` selects stages, and
    `--scan-lean PATH...` runs only the static Lean hygiene scan on the given files without invoking
    Lake (used by `lint-staged`). The `rust` stage covers `crates/botge-quantum` and the
    certificate.
- `../compose.quantum.yaml`: Compose overlay (`mem_limit: 256m`, `read_only: true`, `/tmp` tmpfs)
  setting `BOTGE_QUANTUM_URL` without `depends_on` on `botge`.

## Setup and checks

Install the optional `quantum` extra into `.venv/` and the npm packages (`npm ci`, for
`qsharp-lang`), then verify prerequisites from the repository root (see the
[test guide](../tests/README.md) and the
[Q# reference index](../.agents/references/qsharp/README.md)):

```sh
uv sync --locked --extra quantum
.venv/bin/python scripts/quantum/check_qsharp.py
.venv/bin/python -m ruff check quantum
.venv/bin/python -m ruff format --check quantum
.venv/bin/python -m pyright quantum
```

Run the sidecar and circuit tests and branch coverage without leaving untracked artifacts in the
root directory:

```sh
mkdir -p coverage/python tmp/pytest_cache
.venv/bin/python -m coverage run --branch --data-file=coverage/python/.coverage \
  --source=quantum --omit='quantum/tests/*,quantum/proofs/*' \
  -m pytest -v -o cache_dir=tmp/pytest_cache quantum/tests
.venv/bin/python -m coverage report \
  --data-file=coverage/python/.coverage --show-missing --fail-under=90
```

Validate the Compose overlay, Rego policy, and Dockerfile checks:

```sh
docker compose -f compose.yaml -f compose.quantum.yaml config
docker buildx build --check --file quantum/Dockerfile .
```

## Proof checks

The proofs need elan with the toolchain pinned in `proofs/lean/lean-toolchain`
(`.venv/bin/python scripts/setup/doctor.py --proofs`); SymPy and Z3 come with `uv sync`. Fetch
Mathlib's prebuilt cache once instead of building Mathlib (see the
[Lean reference index](../.agents/references/lean/README.md)):

```sh
(cd quantum/proofs/lean && lake exe cache get)
.venv/bin/python scripts/quantum/check_proofs.py
```

`lake build` treats every linter warning as an error. `lake lint` runs Batteries' environment
linters, and `lake exe audit_axioms` checks that every `BotgeLean` theorem uses only `propext`,
`Classical.choice` and `Quot.sound`. The formalization proves Theorem 4.3 (3) on Botge's admissible
domain only; the [audit](../.agents/references/lean/AUDIT.md) records this and the other scope
notes.

## VS Code troubleshooting

### `Qdk.Qsc.Project.FileSystem` / `[UriError]: Scheme contains illegal characters`

Opening `.qs` files with both `quantum.qsharp-lang-vscode` and `MS-SarifVSCode.sarif-viewer` active
in the same VS Code extension host triggers an upstream collision:

1. `MS-SarifVSCode.sarif-viewer` activates automatically on Git workspaces / JSON files and defines
   a global `String.prototype.path` getter.
2. `quantum.qsharp-lang-vscode`'s `readFileUri` checks
   `maybeUri.path ? maybeUri : vscode.Uri.parse(maybeUri)` instead of
   `typeof maybeUri !== "string"`. Because `String.prototype.path` is truthy on strings, it passes
   the unparsed `file:///.../quantum/qsharp.json` string directly to `vscode.workspace.fs.readFile`,
   causing VS Code's URI parser to fail on `:` inside the scheme.

Because `extensions.experimental.affinity` is application-scoped, VS Code ignores it in
[`.vscode/settings.json`](../.vscode/settings.json). Configure it in your VS Code **User** settings
instead:

1. Open the Command Palette and run **Preferences: Open User Settings (JSON)**.
2. Isolate `MS-SarifVSCode.sarif-viewer` in its own extension host:

   ```json
   "extensions.experimental.affinity": {
     "MS-SarifVSCode.sarif-viewer": 1
   }
   ```

3. Run **Developer: Reload Window**.

Alternatively, disable `MS-SarifVSCode.sarif-viewer` for this workspace and reload the window.

### `deprecatedBorrow` in `qsharp.json`

Upstream `qsharp.schema.json` omits `deprecatedBorrow` even though the Q# compiler implements
`DeprecatedBorrow` with a default `warn` level. `quantum/qsharp.json` keeps all 15 schema-valid
rules at `"error"`, while `scripts/quantum/check_qsharp.py` rejects `borrow` statically as an error;
see the [Q# baseline audit](../.agents/references/qsharp/AUDIT.md).
