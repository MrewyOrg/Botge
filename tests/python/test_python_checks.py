"""Ensure strict analysis includes hidden agent helpers without duplicating policy."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_python


class TypecheckTests(unittest.TestCase):
    """Catch analysis-scope regressions that an empty successful report would hide."""

    def test_rebased_policy_reports_a_real_error_in_a_hidden_folder(self) -> None:
        """Run the installed checker on a hidden fixture and retain strict diagnostics."""
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            root = directory / 'repo'
            source = root / '.agents' / 'scripts'
            source.mkdir(parents=True)
            (source / 'fixture.py').write_text('value: int = "wrong type"\n')
            (root / 'pyproject.toml').write_text(
                '[tool.pyright]\ninclude = [".agents/scripts"]\n'
                'exclude = []\nextraPaths = []\ntypeCheckingMode = "strict"\n'
            )
            configuration = directory / 'config'
            configuration.mkdir()
            with patch.object(check_python, 'ROOT', root):
                path = check_python.typecheck_config(configuration)
            result = subprocess.run(  # noqa: S603 - Known checker and isolated fixture paths.
                (sys.executable, '-m', 'pyright', '--project', str(path)),
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn('fixture.py', result.stdout)
            self.assertIn('reportAssignmentType', result.stdout)


if __name__ == '__main__':
    unittest.main()
