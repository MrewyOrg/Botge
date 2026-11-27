"""Run the symbolic entry point as its CLI."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'verify_symbolic.py'


class EntryPointTests(unittest.TestCase):
    """Check that the CLI runs every section in specification order."""

    def test_cli_passes_every_check_in_order(self) -> None:
        """Each section reports once, in order, before the final summary."""
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run(  # noqa: S603 - Fixed repository script, no arguments.
                (sys.executable, str(SCRIPT)),
                cwd=temporary,
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(
            result.stdout.splitlines(),
            [
                'Proposition 2.1 (Z3): passed',
                'Proposition 3.2 (SymPy): passed',
                'Theorem 4.1 (SymPy): passed',
                'Theorem 4.3 (SymPy, Z3): passed',
                'Corollary 4.4 (SymPy): passed',
                'Theorem 5.1 (SymPy, Z3): passed',
                'All SymPy and Z3 checks passed.',
            ],
        )
