"""Check development prerequisites without installing tools or starting services.

Run with the root virtual environment from any directory. Pins come from
rust-toolchain.toml, .nvmrc, .python-version and pyproject.toml. Rust probes
disable automatic toolchain installation; Docker probes are optional and read-only.
"""

import argparse
import os
import re
import shutil
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable

ROOT = Path(__file__).resolve().parents[1]
# Render fixtures require FFmpeg's animated WebP support from this major release.
MIN_FFMPEG_MAJOR = 9
type Command = tuple[str, ...]
type Runner = Callable[[Command], Result]


@dataclass(frozen=True, slots=True)
class Result:
    """A command's status and diagnostic text, also supplied by offline fixtures."""

    returncode: int
    output: str


def run(command: Command) -> Result:
    """Run a fixed diagnostic command for at most 20 seconds.

    Missing tools, launch failures and timeouts become failed results. Output
    includes stdout and stderr; the child cannot automatically install Rust.
    """
    executable = shutil.which(command[0])
    if executable is None:
        return Result(127, f'Missing executable: {command[0]}')
    try:
        result = subprocess.run(  # noqa: S603 - Fixed diagnostic commands; no shell or CLI inputs.
            (executable, *command[1:]),
            cwd=ROOT,
            env={**os.environ, 'RUSTUP_AUTO_INSTALL': '0'},
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return Result(1, str(error))
    return Result(result.returncode, result.stdout + result.stderr)


def report(label: str, result: Result, *, valid: bool = True) -> bool:
    """Print a compact success or actionable failure, keeping the complete failure output."""
    success = result.returncode == 0 and valid
    lines = result.output.strip().splitlines()
    detail = (lines[0] if lines else 'no output') if success else result.output.strip()
    print(f'{"PASS" if success else "FAIL"} {label}: {detail}')
    return success


def ffmpeg_supported(output: str) -> bool:
    """Require FFmpeg 9 or later, rejecting unknown version formats."""
    match = re.match(r'ffmpeg version (\d+)\.', output)
    return match is not None and int(match[1]) >= MIN_FFMPEG_MAJOR


def diagnose(root: Path, runner: Runner, *, docker: bool) -> bool:
    """Print required prerequisite results and return whether all of them pass.

    Args:
        root: Repository containing version pins and the isolated environment.
        runner: Command capability; tests supply offline responses.
        docker: Include optional read-only Docker probes without affecting success.

    """
    try:
        channel: object = tomllib.loads((root / 'rust-toolchain.toml').read_text())['toolchain'][
            'channel'
        ]
        node = (root / '.nvmrc').read_text().strip().removeprefix('v')
        python = (root / '.python-version').read_text().strip()
        manager: object = tomllib.loads((root / 'pyproject.toml').read_text())['tool']['uv'][
            'required-version'
        ]
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'FAIL prerequisite configuration: {error}')
        return False
    if not isinstance(channel, str):
        print('FAIL prerequisite configuration: Rust channel must be a string')
        return False
    if not isinstance(manager, str) or not manager.startswith('=='):
        print('FAIL prerequisite configuration: uv must have an exact version pin')
        return False

    rust = runner(('rustup', 'show', 'active-toolchain'))
    checks = [report(f'Rust {channel}', rust, valid=rust.output.startswith(f'{channel}-'))]
    version = runner(('node', '--version'))
    checks.append(report(f'Node {node}', version, valid=version.output.strip() == f'v{node}'))
    executable = root / '.venv' / 'bin' / 'python'
    version = runner((str(executable), '--version'))
    checks.append(
        report(f'Python {python}', version, valid=version.output.strip() == f'Python {python}')
    )
    version = runner(('uv', '--version'))
    checks.append(
        report(
            f'uv {manager}',
            version,
            valid=version.output.split()[:2] == ['uv', manager.removeprefix('==')],
        )
    )
    for label, command in (
        ('Cargo', ('cargo', '--version')),
        ('Rust formatter', ('cargo', 'fmt', '--version')),
        ('Clippy', ('cargo', 'clippy', '--version')),
        ('Coverage', ('cargo', 'llvm-cov', '--version')),
        ('Feature checks', ('cargo', 'hack', '--version')),
        ('Unused dependencies', ('cargo', 'udeps', '--version')),
        ('Miri', ('cargo', 'miri', '--version')),
        ('npm', ('npm', '--version')),
        ('Coverage JSON tool', ('jq', '--version')),
        ('Opus development library', ('pkg-config', '--modversion', 'opus')),
        ('FFprobe', ('ffprobe', '-version')),
    ):
        checks.append(report(label, runner(command)))
    installed = os.access(root / 'node_modules' / '.bin' / 'eslint', os.X_OK)
    checks.append(
        report(
            'Node dependencies',
            Result(0 if installed else 1, 'installed' if installed else 'Run npm ci'),
        )
    )
    version = runner(('ffmpeg', '-version'))
    checks.append(report('FFmpeg 9+', version, valid=ffmpeg_supported(version.output)))
    for label, flag, capability in (
        ('WebP encoder', '-encoders', 'libwebp'),
        ('Animated WebP demuxer', '-demuxers', 'webp_anim'),
    ):
        result = runner(('ffmpeg', '-hide_banner', flag))
        checks.append(report(label, result, valid=capability in result.output))
    if docker:
        for command in (('docker', 'context', 'show'), ('docker', 'compose', 'ls')):
            if not report('Optional Docker', runner(command)):
                print('Docker is optional for local Rust, TypeScript and Python checks.')
    return all(checks)


def main() -> None:
    """Check the repository owning this file, regardless of the caller's directory."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    raise SystemExit(0 if diagnose(ROOT, run, docker=shutil.which('docker') is not None) else 1)


if __name__ == '__main__':
    main()
