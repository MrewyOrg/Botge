"""Check Theorem 4.3 and the `(2, 2)` register helpers it relies on."""

import contextlib
import io
import unittest

from symbolic_correlations import (
    signed_sum,
    two_by_two_probabilities,
    verify_heisenberg,
    verify_intra_angles,
    verify_intra_register,
    verify_morrie,
    verify_optimal_readout,
    verify_two_by_two_register,
)
from symbolic_support import sp


class CorrelationTests(unittest.TestCase):
    """Run the correlation checks and probe their helpers directly."""

    def test_correlation_checks_hold(self) -> None:
        """Every Theorem 4.3 step passes."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_heisenberg()
            verify_optimal_readout()
            verify_morrie()
            verify_two_by_two_register()
            verify_intra_angles()
        self.assertEqual(stdout.getvalue(), 'Theorem 4.3 (SymPy, Z3): passed\n')

    def test_signed_sum_flips_odd_parity(self) -> None:
        """Indices with an odd masked popcount are subtracted."""
        w, s = sp.symbols('w s')
        terms = [sp.Poly(value, w, s, domain='ZZ') for value in (1, 2, 4, 8)]
        self.assertEqual(signed_sum(terms, 0b01, w, s), sp.Poly(1 - 2 + 4 - 8, w, s, domain='ZZ'))

    def test_two_by_two_law_has_sixteen_nonnegative_terms(self) -> None:
        """Each scaled Born polynomial has integer coefficients and the full law has 16 outcomes."""
        probabilities, _, _ = two_by_two_probabilities()
        self.assertEqual(len(probabilities), 16)
        self.assertTrue(all(probability.domain == sp.ZZ for probability in probabilities))

    def test_intra_register_rejects_an_odd_phase_power(self) -> None:
        """A moment with an odd power of `s` cannot come from the `(2, 2)` circuit."""
        w, s = sp.symbols('w s')
        with self.assertRaisesRegex(SystemExit, 'odd power of s'):
            verify_intra_register(sp.Poly(w * s, w, s, domain='ZZ'), w)
