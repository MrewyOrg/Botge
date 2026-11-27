"""Unit tests for the curated organic atlas and RDKit SMARTS reaction engine."""

import sys
import unittest
from pathlib import Path
from typing import override
from unittest.mock import patch

CHEMISTRY_DIR = Path(__file__).resolve().parent.parent
if str(CHEMISTRY_DIR) not in sys.path:
    sys.path.insert(0, str(CHEMISTRY_DIR))

from atlas import ATLAS_SIZE, CONDITIONS, REACTIONS, SUBSTRATES  # noqa: E402
from engine import (  # noqa: E402
    ChemistryEngine,
    NoReactionOutcome,
    PoolTarget,
    ReactedOutcome,
    fnv1a_64,
    project_product,
    substrate_index,
)


class EngineTests(unittest.TestCase):
    """Verify FNV-1a mapping, SMARTS reactivity, commutativity, and reactant avoidance."""

    engine: ChemistryEngine

    @classmethod
    @override
    def setUpClass(cls) -> None:
        """Initialize the shared pre-compiled RDKit engine once."""
        cls.engine = ChemistryEngine()

    def test_atlas_has_32_unique_valid_substrates(self) -> None:
        """All 32 atlas entries have contiguous indices, unique names, and unique SMILES."""
        self.assertEqual(len(SUBSTRATES), ATLAS_SIZE)
        self.assertEqual([s.index for s in SUBSTRATES], list(range(ATLAS_SIZE)))
        self.assertEqual(len({s.name for s in SUBSTRATES}), ATLAS_SIZE)
        self.assertEqual(len({s.smiles for s in SUBSTRATES}), ATLAS_SIZE)

    def test_fnv1a_and_substrate_index_vectors(self) -> None:
        """FNV-1a 64-bit matches standard test vectors and maps IDs within `[0, 32)`."""
        self.assertEqual(fnv1a_64(b''), 0xCBF29CE484222325)
        self.assertEqual(fnv1a_64(b'foobar'), 0x85944171F73967E8)
        idx = substrate_index('01H00000000000000000000000')
        self.assertTrue(0 <= idx < ATLAS_SIZE)
        self.assertEqual(idx, substrate_index('01H00000000000000000000000'))

    def test_diels_alder_reaction_and_commutativity(self) -> None:
        """Swapping reactants preserves reaction ID, product SMILES, InChIKey, and indices."""
        target = PoolTarget(64, 16, (1, 2), include_diagram=False)
        forward = self.engine.react(0, 4, 'heat', target)
        reverse = self.engine.react(4, 0, 'heat', target)
        self.assertIsInstance(forward, ReactedOutcome)
        self.assertIsInstance(reverse, ReactedOutcome)
        if not isinstance(forward, ReactedOutcome) or not isinstance(reverse, ReactedOutcome):
            return
        self.assertEqual(forward.reaction_id, 'diels_alder')
        self.assertEqual(forward.condition_used, 'heat')
        self.assertEqual(forward.product_smiles, reverse.product_smiles)
        self.assertEqual(forward.inchi_key, reverse.inchi_key)
        self.assertEqual(forward.base_index, reverse.base_index)
        self.assertEqual(forward.overlay_index, reverse.overlay_index)
        self.assertIsNone(forward.diagram_png_b64)

    def test_all_eight_reactions_succeed_under_auto_and_explicit_conditions(self) -> None:
        """Each of the 8 templates triggers cleanly under both explicit and `auto` conditions."""
        pairs = {
            'diels_alder': (0, 4, 'heat'),
            'fischer_esterification': (8, 11, 'acid'),
            'imine_condensation': (20, 16, 'acid'),
            'amide_coupling': (22, 16, 'base'),
            'williamson_sn2': (11, 24, 'base'),
            'aldol_condensation': (21, 20, 'base'),
            'michael_addition': (30, 5, 'base'),
            'suzuki_miyaura': (26, 28, 'palladium'),
        }
        self.assertEqual(set(pairs), {r.id for r in REACTIONS})
        target = PoolTarget(32, 8, include_diagram=False)
        for rid, (a, b, cond) in pairs.items():
            explicit = self.engine.react(a, b, cond, target)
            auto = self.engine.react(a, b, 'auto', target)
            self.assertIsInstance(explicit, ReactedOutcome)
            self.assertIsInstance(auto, ReactedOutcome)
            if isinstance(explicit, ReactedOutcome) and isinstance(auto, ReactedOutcome):
                self.assertEqual(explicit.reaction_id, rid)
                self.assertEqual(auto.reaction_id, rid)

    def test_self_reaction_aldol_succeeds(self) -> None:
        """Self-aldol of acetaldehyde succeeds and avoids its excluded base index."""
        res = self.engine.react(18, 18, 'base', PoolTarget(10, 4, (0,), include_diagram=False))
        self.assertIsInstance(res, ReactedOutcome)
        if isinstance(res, ReactedOutcome):
            self.assertEqual(res.reaction_id, 'aldol_condensation')
            self.assertNotEqual(res.base_index, 0)

    def test_no_reaction_with_and_without_hint(self) -> None:
        """Incompatible pairs return `NoReactionOutcome` with condition hints when applicable."""
        target = PoolTarget(16, 4, include_diagram=False)
        wrong_cond = self.engine.react(0, 4, 'acid', target)
        self.assertIsInstance(wrong_cond, NoReactionOutcome)
        if isinstance(wrong_cond, NoReactionOutcome):
            self.assertEqual(wrong_cond.hint_condition, 'heat')
            self.assertEqual(wrong_cond.hint_reaction, 'Diels-Alder [4+2] cycloaddition')

        inert = self.engine.react(0, 26, 'auto', target)
        self.assertIsInstance(inert, NoReactionOutcome)
        if isinstance(inert, NoReactionOutcome):
            self.assertIsNone(inert.hint_condition)
            self.assertIsNone(inert.hint_reaction)

        inert_explicit = self.engine.react(0, 0, 'acid', target)
        self.assertIsInstance(inert_explicit, NoReactionOutcome)
        if isinstance(inert_explicit, NoReactionOutcome):
            self.assertIsNone(inert_explicit.hint_condition)
            self.assertIsNone(inert_explicit.hint_reaction)

        # Carboxylic acids and acyl chlorides are excluded from aldol donor matching.
        for a, b in ((8, 18), (22, 20)):
            excluded = self.engine.react(a, b, 'base', target)
            self.assertIsInstance(excluded, NoReactionOutcome)

    def test_engine_defensive_init_and_sanitization_guards(self) -> None:
        """Startup rejects corrupt definitions and sanitization failures drop bad products."""
        self.assertIsNotNone(self.engine.substrate_mol(0))

        with (
            patch('engine.Chem.MolFromSmiles', return_value=None),
            self.assertRaisesRegex(RuntimeError, 'Invalid substrate SMILES'),
        ):
            ChemistryEngine()

        with (
            patch('engine.rdChemReactions.ReactionFromSmarts', return_value=None),
            self.assertRaisesRegex(RuntimeError, 'Invalid reaction SMARTS'),
        ):
            ChemistryEngine()

        with patch('engine.Chem.SanitizeMol', side_effect=ValueError('bad valence')):
            res = self.engine.react(0, 4, 'heat', PoolTarget(16, 4, include_diagram=False))
            self.assertIsInstance(res, NoReactionOutcome)

    def test_projection_avoidance_and_validation(self) -> None:
        """Projection avoids up to 2 indices when `M_b >= 3` and rejects out-of-range inputs."""
        base_0, _ = project_product('SYNTHETIC-TEST-KEY', 5, 2)
        base_1, _ = project_product('SYNTHETIC-TEST-KEY', 5, 2, (base_0,))
        self.assertNotEqual(base_1, base_0)
        base_2, _ = project_product('SYNTHETIC-TEST-KEY', 5, 2, (base_0, base_1))
        self.assertNotIn(base_2, (base_0, base_1))

        # With pool size 2, avoidance is disabled so collisions remain possible.
        b2, o2 = project_product('SYNTHETIC-TEST-KEY', 2, 2, (0, 1))
        self.assertIn(b2, (0, 1))
        self.assertIn(o2, (0, 1))

        with self.assertRaises(ValueError):
            project_product('KEY', 1, 2)
        with self.assertRaises(ValueError):
            project_product('KEY', 2, 1)
        with self.assertRaises(ValueError):
            self.engine.react(32, 0, 'auto', PoolTarget(4, 4))
        with self.assertRaises(ValueError):
            self.engine.react(0, 1, 'plasma', PoolTarget(4, 4))
        self.assertEqual(len(CONDITIONS), 4)


if __name__ == '__main__':
    unittest.main()
