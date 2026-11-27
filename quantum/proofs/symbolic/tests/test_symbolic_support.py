"""Cover failure reporting, zero detection and the Pauli matrices."""

import unittest

from symbolic_support import is_zero, pauli, require, sp


class SupportTests(unittest.TestCase):
    """Check the helpers every symbolic module builds on."""

    def test_require_stops_with_its_message(self) -> None:
        """A false condition stops the run; a true one passes silently."""
        require(condition=True, message='unused')
        with self.assertRaisesRegex(SystemExit, 'broken claim'):
            require(condition=0, message='broken claim')

    def test_is_zero_simplifies_before_comparing(self) -> None:
        """`sin² + cos² - 1` is zero only after simplification; a free symbol is not."""
        x = sp.symbols('x', real=True)
        self.assertTrue(is_zero(sp.sin(x) ** 2 + sp.cos(x) ** 2 - 1))
        self.assertFalse(is_zero(x))

    def test_pauli_matrices_satisfy_their_algebra(self) -> None:
        """Each Pauli matrix squares to the identity and `XY = iZ`."""
        identity, x, y, z = pauli()
        for matrix in (x, y, z):
            self.assertEqual(matrix * matrix, identity)
        self.assertEqual(x * y, sp.I * z)
