# Botge organic chemistry sidecar

CPU-only RDKit bimolecular reaction engine and FastAPI sidecar (`compose.chemistry.yaml`) for Botge.
It maps each catalog emote's immutable ID deterministically to a 32-substrate organic atlas,
evaluates eight heavy-atom-balanced SMARTS reaction templates, projects sanitized products into the
guild's sorted emote pools with reactant avoidance, and renders dark-mode 2D skeletal reaction PNGs
(`320x120`, `<= 128 KiB`).

## HTTP contract

- `GET /healthz`: unauthenticated `{"status": "ok", "backend": "rdkit-cpu"}`.
- `POST /v1/react`: optional `Authorization: Bearer <BOTGE_CHEMISTRY_SECRET>`, checked in constant
  time. Both sides ignore whitespace around the secret, and a blank secret disables authentication.
  Strict JSON body: `reactant_a` (`0..32`), `reactant_b` (`0..32`), `condition`
  (`auto | heat | acid | base | palladium`), `base_pool_size` (`2..=1024`), `overlay_pool_size`
  (`2..=128`), `exclude_base_indices` (0–2 indices `< base_pool_size`), and `include_diagram`
  (default `true`).
- Response is tagged on `"outcome"`:
  - `"reacted"`: `reaction_id`, `reaction_name`, `condition_used`, `substrate_a_name`,
    `substrate_b_name`, `product_smiles`, `product_formula`, `product_mw`, `inchi_key`,
    `base_index`, `overlay_index`, and optional `diagram_png_b64`.
  - `"no_reaction"`: both substrate names and functional groups, `reason`, and optional
    `hint_condition` / `hint_reaction` when another condition succeeds.

## Bot integration

Setting `BOTGE_CHEMISTRY_URL` (and optionally `BOTGE_CHEMISTRY_SECRET`) registers `/react-emote`
with mutual emote/condition compatibility autocomplete showing each emote's deterministic substrate
(`<name> — <substrate> (<group>)`). Compatible reactions render the projected `(base, overlay)`
emote pair via `Application::compose_selected` and post the optional `reaction.png` in a follow-up
reply to the emote message (falling back to an interaction followup when channel messages are
unavailable). Non-reactive pairs delete the deferred placeholder and explain themselves ephemerally;
nothing is faked or drawn classically.

## Checks and proofs

To fetch prebuilt Mathlib `.olean` artifacts before building Lean proofs:

```sh
cd chemistry/proofs/lean && lake exe cache get
```

Run the sidecar and formal proof verification suites:

```sh
uv sync --locked --extra chemistry
.venv/bin/python -m ruff check chemistry
.venv/bin/python -m ruff format --check chemistry
PYTHONPATH=chemistry .venv/bin/python -m pyright chemistry
.venv/bin/python scripts/chemistry/check_chemistry_proofs.py
docker compose -f compose.yaml -f compose.chemistry.yaml config
docker buildx build --check --file chemistry/Dockerfile .
```
