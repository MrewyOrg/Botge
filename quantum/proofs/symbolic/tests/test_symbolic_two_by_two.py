"""Check Corollary 4.4 and that a misprinted value is caught."""

import contextlib
import io
import unittest

from symbolic_support import sp
from symbolic_two_by_two import (
    printed_values,
    verify_two_by_two_closed_form,
    verify_two_by_two_numbers,
)


class TwoByTwoTests(unittest.TestCase):
    """Run the closed form and the printed values, then a wrong printed value."""

    def test_closed_form_and_printed_values_hold(self) -> None:
        """The exact state matches and every printed value is correctly rounded."""
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            verify_two_by_two_closed_form()
            verify_two_by_two_numbers()
        self.assertEqual(stdout.getvalue(), 'Corollary 4.4 (SymPy): passed\n')
        self.assertEqual(len(printed_values()), 5)

    def test_misprinted_value_fails(self) -> None:
        """A value off by one unit in its last printed digit fails, and so does a wrong value."""
        expression, _ = printed_values()[1]
        with self.assertRaisesRegex(SystemExit, 'is not 0.3657'):
            verify_two_by_two_numbers(((expression, '0.3657'),))
        with self.assertRaisesRegex(SystemExit, 'is not 0.5'):
            verify_two_by_two_numbers(((sp.Rational(1, 3), '0.5'),))
