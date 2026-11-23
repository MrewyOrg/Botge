"""Verify the actionlint workspace, failure propagation, and cleanup."""

import contextlib
import io
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import lint_workflows


class WorkflowLintTests(unittest.TestCase):
    """Linting uses staged files and works with or without local actions."""

    def test_missing_tools_fail(self) -> None:
        """Missing actionlint or ShellCheck returns a useful prerequisite error."""
        for tools in ((None,), ('/bin/actionlint', None)):
            with (
                self.subTest(tools=tools),
                patch.object(lint_workflows.shutil, 'which', side_effect=tools),
                contextlib.redirect_stderr(io.StringIO()) as stderr,
            ):
                self.assertEqual(lint_workflows.lint(Path('/unused')), 1)
                self.assertIn('Install actionlint and ShellCheck', stderr.getvalue())

    def test_stages_workflows_and_propagates_actionlint_status(self) -> None:
        """Only local references change, original files survive, and the scratch tree is removed."""
        for with_action, status in ((True, 7), (False, 0)):
            with self.subTest(with_action=with_action):
                self.check_staging(with_action=with_action, status=status)

    def check_staging(self, *, with_action: bool, status: int) -> None:
        """Check one staged checkout and linter outcome."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            github = root / '.github'
            workflows = github / 'workflows'
            workflows.mkdir(parents=True)
            (github / 'actionlint.yaml').write_text('config\n')
            local = '    - uses: $/.github/actions/example\n'
            upstream = '    - uses: owner/action@v1\n'
            (workflows / 'main.yml').write_text(local + upstream)
            (workflows / 'other.yaml').write_text('jobs: {}\n')
            (workflows / 'notes.yuml').write_text('ignored')
            (workflows / 'directory.yml').mkdir()
            if with_action:
                (github / 'actions').mkdir()
                (github / 'actions' / 'action.yml').write_text('action\n')

            def execute(
                command: tuple[str, str], *, cwd: Path, check: bool
            ) -> subprocess.CompletedProcess[str]:
                self.assertEqual(command, ('/bin/actionlint', '-color=false'))
                self.assertFalse(check)
                staged = cwd / '.github'
                self.assertTrue((cwd / '.git').is_dir())
                self.assertEqual((staged / 'actionlint.yaml').read_text(), 'config\n')
                self.assertEqual(
                    (staged / 'workflows' / 'main.yml').read_text(),
                    local.replace('$/', './') + upstream,
                )
                self.assertEqual(
                    sorted(path.name for path in (staged / 'workflows').iterdir()),
                    ['main.yml', 'other.yaml'],
                )
                self.assertEqual((staged / 'actions' / 'action.yml').is_file(), with_action)
                return subprocess.CompletedProcess(command, status)

            with (
                patch.object(lint_workflows.shutil, 'which', return_value='/bin/actionlint'),
                patch.object(lint_workflows.subprocess, 'run', side_effect=execute) as run,
            ):
                self.assertEqual(lint_workflows.lint(root), status)
            self.assertFalse(run.call_args.kwargs['cwd'].exists())
            self.assertEqual((workflows / 'main.yml').read_text(), local + upstream)

    def test_main_exits_with_lint_status(self) -> None:
        """The command preserves the exit status returned by lint."""
        with (
            patch('sys.argv', ['lint_workflows.py']),
            patch.object(lint_workflows, 'lint', return_value=3),
            self.assertRaises(SystemExit) as error,
        ):
            lint_workflows.main()
        self.assertEqual(error.exception.code, 3)
