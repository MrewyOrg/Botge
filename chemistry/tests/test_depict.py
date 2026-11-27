"""Unit tests for dark-mode 2D skeletal reaction diagram rendering."""

import base64
import struct
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

CHEMISTRY_DIR = Path(__file__).resolve().parent.parent
if str(CHEMISTRY_DIR) not in sys.path:
    sys.path.insert(0, str(CHEMISTRY_DIR))

from depict import (  # noqa: E402
    DIAGRAM_HEIGHT,
    DIAGRAM_WIDTH,
    MAX_DIAGRAM_BYTES,
    PNG_MAGIC,
    render_reaction_png,
    render_reaction_png_b64,
)
from engine import ChemistryEngine, PoolTarget, ReactedOutcome  # noqa: E402


class DepictTests(unittest.TestCase):
    """Verify dark-mode PNG generation, magic bytes, and size enforcement."""

    def test_render_reaction_png_and_base64(self) -> None:
        """Dark-mode depiction yields valid PNG bytes within the 128 KiB limit."""
        engine = ChemistryEngine()
        mol_a = engine.substrate_mol(0)
        mol_b = engine.substrate_mol(4)
        outcome = engine.react(0, 4, 'heat', PoolTarget(16, 4, include_diagram=True))
        self.assertIsInstance(outcome, ReactedOutcome)
        if not isinstance(outcome, ReactedOutcome) or outcome.diagram_png_b64 is None:
            self.fail('Expected ReactedOutcome with diagram_png_b64')
        raw = base64.b64decode(outcome.diagram_png_b64, validate=True)
        self.assertTrue(raw.startswith(PNG_MAGIC))
        self.assertEqual(struct.unpack('>II', raw[16:24]), (DIAGRAM_WIDTH, DIAGRAM_HEIGHT))
        self.assertLessEqual(len(raw), MAX_DIAGRAM_BYTES)

        direct = render_reaction_png(mol_a, mol_b, mol_b)
        self.assertTrue(direct.startswith(PNG_MAGIC))
        direct_b64 = render_reaction_png_b64(mol_a, mol_b, mol_b)
        self.assertEqual(base64.b64decode(direct_b64, validate=True), direct)

    def test_invalid_or_oversized_png_rejected(self) -> None:
        """Corrupt or oversized PNG payloads raise ValueError."""
        engine = ChemistryEngine()
        mol_a = engine.substrate_mol(0)
        mol_b = engine.substrate_mol(4)
        with (
            patch('depict.rdMolDraw2D.MolDraw2DCairo') as mock_cairo,
            self.assertRaises(ValueError),
        ):
            mock_cairo.return_value.GetDrawingText.return_value = b'NOT-A-PNG'
            render_reaction_png(mol_a, mol_b, mol_b)

        oversized = PNG_MAGIC + b'x' * MAX_DIAGRAM_BYTES
        with (
            patch('depict.rdMolDraw2D.MolDraw2DCairo') as mock_cairo,
            self.assertRaises(ValueError),
        ):
            mock_cairo.return_value.GetDrawingText.return_value = oversized
            render_reaction_png(mol_a, mol_b, mol_b)


if __name__ == '__main__':
    unittest.main()
