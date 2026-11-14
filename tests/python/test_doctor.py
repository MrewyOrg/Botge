# cspell:words demuxer demuxers libwebp webp
"""Exercise prerequisite failures without starting services or using installed tools."""

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from doctor import Command, Result, diagnose, ffmpeg_supported, run


def prerequisites(root: Path) -> dict[Command, Result]:
    """Create a standalone repository fixture and synthetic command responses."""
    (root / 'rust-toolchain.toml').write_text('[toolchain]\nchannel = "nightly-2026-11-10"\n')
    (root / '.nvmrc').write_text('26.13.0\n')
    (root / '.python-version').write_text('3.15.2\n')
    (root / 'pyproject.toml').write_text('[tool.uv]\nrequired-version = "==0.13.8"\n')
    executable = root / 'node_modules' / '.bin' / 'eslint'
    executable.parent.mkdir(parents=True)
    executable.touch(mode=0o755)
    return {
        ('rustup', 'show', 'active-toolchain'): Result(0, 'nightly-2026-11-10-fixture (default)'),
        ('node', '--version'): Result(0, 'v26.13.0'),
        ('uv', '--version'): Result(0, 'uv 0.13.8'),
        (str(root / '.venv' / 'bin' / 'python'), '--version'): Result(0, 'Python 3.15.2'),
        ('ffmpeg', '-version'): Result(0, 'ffmpeg version 9.0.2'),
        ('ffmpeg', '-hide_banner', '-encoders'): Result(0, 'libwebp'),
        ('ffmpeg', '-hide_banner', '-demuxers'): Result(0, 'webp_anim'),
    }


class DoctorTests(unittest.TestCase):
    """Report every required failure while keeping optional probes informational."""

    def test_help_and_invalid_arguments_do_not_probe_the_environment(self) -> None:
        """Both entry points handle CLI arguments before running checks or reading pins."""
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as temporary:
            for script in ('doctor.py', 'check_python.py', 'doc_python.py'):
                for argument, code in (('--help', 0), ('--unknown', 2)):
                    with self.subTest(script=script, argument=argument):
                        result = subprocess.run(  # noqa: S603 - Local entry points and fixed arguments.
                            (sys.executable, str(root / 'scripts' / script), argument),
                            cwd=temporary,
                            env={'PATH': temporary},
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
                        self.assertIn('usage:', result.stdout + result.stderr)
                        self.assertNotIn('PASS ', result.stdout)
                        self.assertNotIn('FAIL ', result.stdout)

    def test_required_failures_do_not_stop_later_checks(self) -> None:
        """Reject mismatches, missing capabilities and command failures without short circuiting."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            responses = prerequisites(root)
            failures = {
                ('rustup', 'show', 'active-toolchain'): Result(0, 'stable-fixture'),
                ('node', '--version'): Result(0, 'v25.0.0'),
                ('uv', '--version'): Result(0, 'uv 0.12.0'),
                (str(root / '.venv' / 'bin' / 'python'), '--version'): Result(127, 'missing'),
                ('cargo', 'clippy', '--version'): Result(1, 'missing component'),
                ('ffmpeg', '-version'): Result(0, 'ffmpeg version 8.0.0'),
                ('ffmpeg', '-hide_banner', '-demuxers'): Result(0, 'no supported demuxer'),
            }
            calls: list[Command] = []
            active: dict[Command, Result] = {}

            def runner(args: Command) -> Result:
                calls.append(args)
                return active.get(args, Result(0, 'fixture'))

            for command, failure in failures.items():
                calls.clear()
                active = {**responses, command: failure}
                output = io.StringIO()
                with self.subTest(command=command), contextlib.redirect_stdout(output):
                    self.assertFalse(diagnose(root, runner, docker=False))
                self.assertIn('FAIL', output.getvalue())
                self.assertIn(('ffmpeg', '-hide_banner', '-demuxers'), calls)

    def test_optional_docker_failure_keeps_a_healthy_environment_successful(self) -> None:
        """An unavailable daemon does not turn required checks into a failure."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            responses = prerequisites(root)
            responses[('docker', 'compose', 'ls')] = Result(1, 'daemon unavailable')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertTrue(
                    diagnose(
                        root, lambda args: responses.get(args, Result(0, 'fixture')), docker=True
                    )
                )
            self.assertIn('Docker is optional', output.getvalue())
            self.assertTrue(ffmpeg_supported('ffmpeg version 10.0.0'))
            self.assertFalse(ffmpeg_supported('unrecognized build'))

    def test_runner_handles_absence_timeout_and_disables_rustup_installation(self) -> None:
        """Missing or hung tools produce diagnostics; probes never trigger a toolchain download."""
        with patch('doctor.shutil.which', return_value=None):
            self.assertEqual(run(('cargo', '--version')).returncode, 127)
        with (
            patch('doctor.shutil.which', return_value='/fixture/cargo'),
            patch('doctor.subprocess.run', side_effect=subprocess.TimeoutExpired('cargo', 20)),
        ):
            self.assertNotEqual(run(('cargo', '--version')).returncode, 0)
        completed = subprocess.CompletedProcess(('cargo', '--version'), 0, 'fixture', '')
        with (
            patch('doctor.shutil.which', return_value='/fixture/cargo'),
            patch('doctor.subprocess.run', return_value=completed) as execute,
        ):
            self.assertEqual(run(('cargo', '--version')), Result(0, 'fixture'))
            self.assertEqual(execute.call_args.kwargs['env']['RUSTUP_AUTO_INSTALL'], '0')
            self.assertEqual(execute.call_args.kwargs['timeout'], 20)
            self.assertNotIn('shell', execute.call_args.kwargs)


if __name__ == '__main__':
    unittest.main()
