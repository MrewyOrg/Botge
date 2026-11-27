"""Unit and negative counterexample tests for chemistry symbolic and Z3 proofs."""

import runpy
import unittest
from pathlib import Path

import verify_chem_symbolic as sym

SCRIPT_PATH = Path(__file__).resolve().parents[1] / 'verify_chem_symbolic.py'


class ChemistrySymbolicTests(unittest.TestCase):
    """Ensure SymPy and Z3 checks pass for valid invariants and catch broken ones."""

    def test_valid_invariants_pass(self) -> None:
        """All symbolic stoichiometry, commutativity, and Z3 projection checks pass."""
        sym.main()
        runpy.run_path(str(SCRIPT_PATH), run_name='__main__')

    def test_z3_catches_broken_avoidance_threshold(self) -> None:
        """Lowering `min_avoid_pool` to 4 leaves `M_b = 3` un-avoided, caught by Z3."""
        self.assertFalse(sym.projection_bounds_hold(min_avoid_pool=4))

    def test_require_exits_on_false(self) -> None:
        """Helper raises SystemExit with diagnostic message on false condition."""
        with self.assertRaises(SystemExit):
            sym.require(condition=False, message='broken')


if __name__ == '__main__':
    unittest.main()
