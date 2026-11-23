"""Exercise shell coverage policy, test fixtures, and Linux and macOS runner dispatch."""

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run_shell_tests as runner


def write_report(report: Path, files: list[tuple[Path, list[int]]]) -> None:
    """Write a fixture with the filename and line counters emitted by kcov."""
    with report.open('w', encoding='utf-8') as output:
        output.write('<coverage>')
        for name, hits in files:
            output.write(f'<class filename="{name}"><lines>')
            for number, count in enumerate(hits, 1):
                output.write(f'<line number="{number}" hits="{count}"/>')
            output.write('</lines></class>')
        output.write('</coverage>')


class ShellRunnerTests(unittest.TestCase):
    """Check both the coverage decision and the inputs to each runtime."""

    def test_coverage_merges_hits_without_double_counting(self) -> None:
        """Accept exactly 90% using matching relative and absolute filenames."""
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / 'work'
            script = Path('scripts/run.sh')
            report = Path(temporary) / 'report.xml'
            write_report(
                report,
                [(script, [1] * 8 + [0, 0]), (workspace / script, [0] * 8 + [1, 0])],
            )
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertTrue(runner.check_report(report, workspace, [script]))
            self.assertIn('9/10 (90.0%)', stdout.getvalue())

    def test_coverage_rejects_shortfalls_and_missing_files(self) -> None:
        """Reject coverage just below 90%, absent files, and reports outside the workspace."""
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            workspace = directory / 'work'
            partial = Path('scripts/partial.sh')
            missing = Path('scripts/missing.sh')
            empty = Path('scripts/empty.sh')
            report = directory / 'report.xml'
            write_report(
                report,
                [(partial, [1] * 8999 + [0] * 1001), (directory / missing, [1]), (empty, [])],
            )
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                self.assertFalse(runner.check_report(report, workspace, [partial, missing, empty]))
            self.assertIn('Below 90%', stdout.getvalue())
            self.assertIn(f'{missing}: missing executable-line coverage', stdout.getvalue())
            self.assertIn(f'{empty}: missing executable-line coverage', stdout.getvalue())

    def test_fixture_copies_rebase_host_paths_and_refuse_symlinks(self) -> None:
        """Preserve script line numbers and avoid copying data through a symlink."""
        examples = (
            ('botge_control/setup.sh', '. /etc/os-release\n((EUID == 0))\n'),
            ('scripts/ios/check-ios.sh', 'bundle=$(/usr/libexec/PlistBuddy -c Print test)\n'),
            ('scripts/plain.sh', 'echo ok\n'),
        )
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            root = Path(temporary)
            workspace = root / 'copies'
            stack.enter_context(patch.object(runner, 'ROOT', root))
            for name, original in examples:
                source = root / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text(original)
                runner.copy_fixture(Path(name), workspace)
                self.assertEqual((workspace / name).read_text().count('\n'), original.count('\n'))
                self.assertEqual(source.read_text(), original)
            self.assertEqual(
                (workspace / 'botge_control/setup.sh').read_text(),
                '. ${BOTGE_TEST_ROOT:?}/etc/os-release\n((BOTGE_TEST_EUID == 0))\n',
            )
            self.assertIn(
                '${BOTGE_TEST_ROOT:?}/PlistBuddy',
                (workspace / 'scripts/ios/check-ios.sh').read_text(),
            )
            self.assertEqual((workspace / 'scripts/plain.sh').read_text(), 'echo ok\n')
            (root / 'linked.sh').symlink_to(root / 'scripts/plain.sh')
            with self.assertRaisesRegex(SystemExit, 'Expected a regular test input'):
                runner.copy_input(Path('linked.sh'), workspace)

    def test_inventory_keeps_existing_shell_files_once(self) -> None:
        """Handle a renamed, duplicate, or space-containing file from Git."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'a script.sh').touch()
            (root / 'b.sh').touch()
            data = b'b.sh\0deleted.sh\0a script.sh\0b.sh\0README.md\0'
            with (
                patch.object(runner, 'ROOT', root),
                patch.object(runner.shutil, 'which', return_value='/fixture/git'),
                patch.object(runner.subprocess, 'check_output', return_value=data) as git,
            ):
                self.assertEqual(runner.shell_scripts(), [Path('a script.sh'), Path('b.sh')])
                git.assert_called_once_with(
                    (
                        '/fixture/git',
                        'ls-files',
                        '-z',
                        '--cached',
                        '--others',
                        '--exclude-standard',
                    ),
                    cwd=root,
                )
        with (
            patch.object(runner.shutil, 'which', return_value=None),
            self.assertRaisesRegex(SystemExit, 'Missing kcov'),
        ):
            runner.command('kcov')

    def test_linux_runs_both_passes_and_enforces_the_report(self) -> None:
        """Use the real fixture setup and report parser with simulated tool invocations."""
        self.check_linux(passing=True)
        self.check_linux(passing=False)

    def check_linux(self, *, passing: bool) -> None:
        """Check the Linux invocation, fixture reset, and pass or fail outcome."""
        script = Path('scripts/quality/lint-shell.sh')

        def executable(name: str) -> str:
            return f'/fixture/bin/{name}'

        def execute(
            invocation: tuple[str, ...], *, cwd: Path, env: dict[str, str], check: bool
        ) -> subprocess.CompletedProcess[str]:
            self.assertTrue(check)
            self.assertTrue((cwd / script).is_file())
            self.assertTrue((cwd / 'tests/shell/build.bats').is_file())
            self.assertEqual(env['BOTGE_TEST_REPO'], str(cwd))
            marker = cwd / 'first-pass.txt'
            if env['BOTGE_SHELL_COVERAGE'] == '0':
                self.assertEqual(invocation[0], '/fixture/bin/bats')
                marker.touch()
            else:
                self.assertFalse(marker.exists())
                self.assertEqual(invocation[0], '/fixture/bin/kcov')
                self.assertIn(f'--include-path={cwd}', invocation)
                output = Path(invocation[-4])
                (output / 'bats').mkdir(parents=True)
                write_report(
                    output / 'bats/cobertura.xml',
                    [(script, [1, 1] if passing else [1, 0])],
                )
            return subprocess.CompletedProcess(invocation, 0)

        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(runner, 'command', side_effect=executable),
            patch.object(runner.subprocess, 'run', side_effect=execute) as commands,
            contextlib.redirect_stdout(io.StringIO()),
        ):
            reports = Path(temporary) / 'reports'
            if passing:
                runner.run_linux([script], reports)
            else:
                with self.assertRaises(SystemExit) as raised:
                    runner.run_linux([script], reports)
                self.assertEqual(raised.exception.code, 1)
            self.assertEqual(commands.call_count, 2)
            self.assertTrue((reports / 'kcov/bats/cobertura.xml').is_file())

    def test_macos_builds_with_policy_and_passes_only_test_inputs(self) -> None:
        """Check the Buildx context, offline test container, and output mount."""
        script = Path('scripts/quality/lint-shell.sh')
        with tempfile.TemporaryDirectory() as temporary:
            reports = Path(temporary) / 'reports'

            def execute(
                invocation: tuple[str, ...], *, check: bool, cwd: Path | None = None
            ) -> subprocess.CompletedProcess[str]:
                self.assertTrue(check)
                if invocation[1:3] == ('buildx', 'build'):
                    self.assertIn('reset=true,filename=Dockerfile.rego,strict=true', invocation)
                    self.assertEqual(
                        {path.name for path in Path(cwd or '').iterdir()},
                        {'Dockerfile', 'Dockerfile.rego'},
                    )
                else:
                    self.assertEqual(invocation[1], 'run')
                    self.assertIn('--network=none', invocation)
                    self.assertIn(f'type=bind,source={reports},target=/reports', invocation)
                    mount = next(
                        arg for arg in invocation if arg.endswith(',target=/inputs,readonly')
                    )
                    inputs = Path(mount.split(',')[1].removeprefix('source='))
                    self.assertEqual(
                        (inputs / 'shell-files').read_bytes(), b'scripts/quality/lint-shell.sh\0'
                    )
                    self.assertTrue((inputs / 'scripts/quality/run_shell_tests.py').is_file())
                    self.assertFalse((inputs / '.git').exists())
                    self.assertFalse((inputs / '.env').exists())
                    self.assertEqual(
                        invocation[-2:],
                        ('/inputs/scripts/quality/run_shell_tests.py', '--container'),
                    )
                return subprocess.CompletedProcess(invocation, 0)

            with (
                patch.object(runner, 'command', return_value='/fixture/bin/docker'),
                patch.object(runner.subprocess, 'run', side_effect=execute) as commands,
            ):
                runner.run_macos([script], reports)
            self.assertEqual(commands.call_count, 2)

    def test_main_routes_platforms_and_container_inventory(self) -> None:
        """Select the platform runner and pass the inventory from macOS through to Linux."""
        scripts = [Path('scripts/example.sh')]
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(runner, 'ROOT', Path(temporary)),
            patch.object(runner, 'shell_scripts', return_value=scripts) as inventory,
            patch.object(runner, 'run_linux') as linux,
            patch.object(runner, 'run_macos') as macos,
            patch.object(sys, 'argv', ['run_shell_tests.py']),
        ):
            for platform, selected in (('linux', linux), ('darwin', macos)):
                with patch.object(sys, 'platform', platform):
                    runner.main()
                selected.assert_called_once_with(scripts, Path(temporary) / 'coverage/shell')
            with (
                patch.object(sys, 'platform', 'win32'),
                self.assertRaisesRegex(SystemExit, 'requires Linux or macOS'),
            ):
                runner.main()
            (Path(temporary) / 'shell-files').write_bytes(b'scripts/example.sh\0')
            with patch.object(sys, 'argv', ['run_shell_tests.py', '--container']):
                runner.main()
            linux.assert_called_with(scripts, Path('/reports'))
            self.assertEqual(inventory.call_count, 2)
