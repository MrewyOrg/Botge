"""Run locked, strict Python checks and offline tests from the root environment.

Use the interpreter created by uv sync --locked. The check reads pyproject.toml
and uv.lock, creates a temporary Pyright configuration and removes it on exit.
It stops at the first failed gate without fetching tools or starting services.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import cast

ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    'scripts',
    'tests/python',
    '.agents/scripts',
    '.agents/tests',
    'quantum/proofs/symbolic',
    'chemistry/proofs/symbolic',
)


def typecheck_config(directory: Path) -> Path:
    """Write a temporary policy with paths rebased from the root pyproject.toml.

    The caller owns directory cleanup. Rebased paths include hidden agent helpers
    that the pinned Pyright CLI would otherwise skip.

    Raises:
        OSError: Configuration cannot be read or written.
        ValueError: The root TOML cannot be parsed.
        KeyError: Required type-checker policy fields are missing.
        TypeError: Required policy fields have incompatible shapes.

    """
    settings: dict[str, object] = tomllib.loads((ROOT / 'pyproject.toml').read_text())['tool'][
        'pyright'
    ]
    for key in ('include', 'exclude', 'extraPaths'):
        # These values are maintained string arrays in the repository's own policy.
        settings[key] = [
            os.path.relpath(ROOT / path, directory) for path in cast('list[str]', settings[key])
        ]
    settings['venvPath'] = os.path.relpath(ROOT, directory)
    configuration = directory / 'pyrightconfig.json'
    configuration.write_text(json.dumps(settings))
    return configuration


def main() -> None:
    """Stop on the first failed gate without installing dependencies or starting services."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    python = sys.executable
    with tempfile.TemporaryDirectory(prefix='botge-python-check-') as temporary:
        configuration = typecheck_config(Path(temporary))
        for command in (
            ('uv', 'lock', '--check', '--offline', '--no-python-downloads'),
            (python, '-m', 'ruff', 'check', *SOURCES),
            (python, '-m', 'ruff', 'format', '--check', *SOURCES),
            (python, '-m', 'pyright', '--project', str(configuration)),
            (python, str(ROOT / 'tests' / 'python' / 'run_coverage.py')),
        ):
            executable = shutil.which(command[0])
            if executable is None:
                message = f'Missing {command[0]}; follow scripts/README.md'
                raise SystemExit(message)
            result = subprocess.run(  # noqa: S603 - Fixed checks and repository-owned paths; no shell.
                (executable, *command[1:]),
                cwd=ROOT,
                env={
                    **os.environ,
                    'PYTHONPATH': os.pathsep.join(
                        map(
                            str,
                            (
                                *sorted({path.parent for path in (ROOT / 'scripts').rglob('*.py')}),
                                *(ROOT / path for path in SOURCES[1:]),
                            ),
                        )
                    ),
                },
                check=False,
            )
            if result.returncode:
                raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
