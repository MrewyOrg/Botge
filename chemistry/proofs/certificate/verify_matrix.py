"""Exhaustive 5,120-triple RDKit matrix certificate for chemistry/docs/botge-chemistry.tex."""

import base64
import json
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CHEMISTRY_DIR = REPO_ROOT / 'chemistry'
if str(CHEMISTRY_DIR) not in sys.path:
    sys.path.insert(0, str(CHEMISTRY_DIR))

from atlas import ATLAS_SIZE, CONDITIONS, REACTIONS, SUBSTRATES  # noqa: E402
from depict import MAX_DIAGRAM_BYTES, PNG_MAGIC  # noqa: E402
from engine import (  # noqa: E402
    ChemistryEngine,
    NoReactionOutcome,
    PoolTarget,
    ReactedOutcome,
    heavy_atom_counts,
)
from rdkit import Chem  # noqa: E402

EXPECTED_EXPLICIT_COUNTS: dict[str, int] = {
    'diels_alder': 32,
    'fischer_esterification': 18,
    'imine_condensation': 36,
    'amide_coupling': 16,
    'williamson_sn2': 12,
    'aldol_condensation': 32,
    'michael_addition': 12,
    'suzuki_miyaura': 8,
}
EXPECTED_TOTAL_REACTED = 332
EXPECTED_TOTAL_NON_REACTIVE = 4788


def _verify_reacted_triple(
    engine: ChemistryEngine,
    byproduct_map: dict[str, Counter[str]],
    pair: tuple[int, int, str],
    fwd: ReactedOutcome,
    rev: ReactedOutcome | NoReactionOutcome,
) -> int:
    """Validate commutativity, avoidance, PNG bounds, and atom balance for one triple."""
    i, j, _condition = pair
    if not isinstance(rev, ReactedOutcome):
        msg = f'Commutativity failure on {pair}'
        raise SystemExit(msg)
    if (
        fwd.reaction_id != rev.reaction_id
        or fwd.product_smiles != rev.product_smiles
        or fwd.inchi_key != rev.inchi_key
        or fwd.base_index != rev.base_index
        or fwd.overlay_index != rev.overlay_index
    ):
        msg = f'Order variance on {pair}'
        raise SystemExit(msg)
    if fwd.base_index in {0, 1}:
        msg = f'Avoidance failure on {pair}'
        raise SystemExit(msg)
    if fwd.diagram_png_b64 is None:
        msg = f'Missing PNG diagram on {pair}'
        raise SystemExit(msg)
    png = base64.b64decode(fwd.diagram_png_b64, validate=True)
    if not png.startswith(PNG_MAGIC) or not (1 <= len(png) <= MAX_DIAGRAM_BYTES):
        msg = f'Invalid PNG bytes on {pair}: {len(png)}'
        raise SystemExit(msg)

    prod_mol = Chem.MolFromSmiles(fwd.product_smiles)  # pyright: ignore[reportUnknownMemberType]
    if prod_mol is None:  # pyright: ignore[reportUnnecessaryComparison]
        msg = f'Product failed re-parse: {fwd.product_smiles}'
        raise SystemExit(msg)
    expected_atoms = (
        heavy_atom_counts(engine.substrate_mol(i))
        + heavy_atom_counts(engine.substrate_mol(j))
        - byproduct_map[fwd.reaction_id]
    )
    if heavy_atom_counts(prod_mol) != expected_atoms:
        msg = f'Stoichiometry mismatch on {pair}'
        raise SystemExit(msg)
    return len(png)


def verify_matrix() -> dict[str, object]:
    """Run all 5,120 triples and verify stoichiometry, commutativity, and PNG bounds."""
    engine = ChemistryEngine()
    target = PoolTarget(base_pool_size=64, overlay_pool_size=16, exclude_base_indices=(0, 1))
    explicit_counts: Counter[str] = Counter()
    auto_counts: Counter[str] = Counter()
    non_reactive_explicit = 0
    non_reactive_auto = 0
    max_png_bytes = 0
    byproduct_map = {r.id: Counter(r.byproduct_atoms) for r in REACTIONS}

    for condition in ('auto', *CONDITIONS):
        for i in range(ATLAS_SIZE):
            for j in range(ATLAS_SIZE):
                fwd = engine.react(i, j, condition, target)
                rev = engine.react(j, i, condition, target)
                if isinstance(fwd, ReactedOutcome):
                    png_len = _verify_reacted_triple(
                        engine,
                        byproduct_map,
                        (i, j, condition),
                        fwd,
                        rev,
                    )
                    max_png_bytes = max(max_png_bytes, png_len)
                    target_counter = auto_counts if condition == 'auto' else explicit_counts
                    target_counter[fwd.reaction_id] += 1
                else:
                    if not isinstance(rev, NoReactionOutcome):
                        msg = f'Commutativity failure on non-reactive {(i, j, condition)}'
                        raise SystemExit(msg)
                    if condition == 'auto':
                        non_reactive_auto += 1
                    else:
                        non_reactive_explicit += 1

    if dict(explicit_counts) != EXPECTED_EXPLICIT_COUNTS:
        msg = f'Explicit counts mismatch: {dict(explicit_counts)}'
        raise SystemExit(msg)
    if dict(auto_counts) != EXPECTED_EXPLICIT_COUNTS:
        msg = f'Auto counts mismatch: {dict(auto_counts)}'
        raise SystemExit(msg)
    total_reacted = sum(explicit_counts.values()) + sum(auto_counts.values())
    total_non_reactive = non_reactive_explicit + non_reactive_auto
    if total_reacted != EXPECTED_TOTAL_REACTED or total_non_reactive != EXPECTED_TOTAL_NON_REACTIVE:
        msg = f'Totals mismatch: reacted={total_reacted}, non_reactive={total_non_reactive}'
        raise SystemExit(msg)

    return {
        'atlas_size': len(SUBSTRATES),
        'triples_checked': ATLAS_SIZE * ATLAS_SIZE * (1 + len(CONDITIONS)),
        'total_reacted': total_reacted,
        'total_non_reactive': total_non_reactive,
        'explicit_counts': dict(explicit_counts),
        'auto_counts': dict(auto_counts),
        'non_reactive_explicit': non_reactive_explicit,
        'non_reactive_auto': non_reactive_auto,
        'max_png_bytes': max_png_bytes,
    }


if __name__ == '__main__':
    summary = verify_matrix()
    print(json.dumps(summary, sort_keys=True))
