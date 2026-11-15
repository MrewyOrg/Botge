"""Keep coverage thresholds exact, including empty and invalid measurement categories."""

import unittest

from run_coverage import meets_budget


class CoveragePolicyTests(unittest.TestCase):
    """Prevent rounding or malformed counts from bypassing a category's budget."""

    def test_budget_boundary_and_invalid_counts(self) -> None:
        """Exactly 90% passes; below-threshold, negative and over-counted data fail."""
        for covered, total, expected in (
            (90, 100, True),
            (89, 100, False),
            (8999, 10000, False),
            (0, 0, True),
            (1, 0, False),
            (-1, 10, False),
            (11, 10, False),
        ):
            with self.subTest(covered=covered, total=total):
                self.assertEqual(meets_budget(covered=covered, total=total), expected)
