"""Check the Proposition 3.2 gate expansions."""

import contextlib
import io
import unittest

from symbolic_circuit import verify_coupling, verify_pauli_expansion


class CircuitTests(unittest.TestCase):
    """Run the register and coupling expansions."""

    def test_expansions_hold(self) -> None:
        """Both expansions pass for every checked register width."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_pauli_expansion()
            verify_coupling()
        self.assertEqual(stdout.getvalue(), 'Proposition 3.2 (SymPy): passed\n')
