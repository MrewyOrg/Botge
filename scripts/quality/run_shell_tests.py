"""Run Bats and enforce per-file shell line coverage on Linux or macOS."""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MINIMUM = 90
IMAGE = 'botge-shell-tests:local'
FIXTURES = (
    'scripts/rust/coverage.jq',
    'scripts/ios/coverage.jq',
    'compose.yaml',
    'botge.example.config.jsonc',
    '.env.example',
    'nginx/botge-nginx.conf',
    'botge_control/systemd/botge_control.socket',
    'botge_control/systemd/botge_control@.service',
    'tests/shell/helpers.bash',
    'scripts/quality/run_shell_tests.py',
)
HOST_SCRIPTS = {
    Path('botge_control') / f'{name}.sh'
    for name in ('config', 'import_data', 'inspect', 'setup', 'setup_docker', 'teardown')
}
HOST_PATH = re.compile(r'/(?:var/run|etc|opt|home|run|usr/local/bin)/(?!<)')
TOOLS = (
    'awk',
    'basename',
    'bash',
    'cat',
    'chmod',
    'cmp',
    'cp',
    'cut',
    'date',
    'dirname',
    'env',
    'find',
    'flock',
    'grep',
    'head',
    'id',
    'install',
    'jq',
    'ln',
    'ls',
    'mkdir',
    'mktemp',
    'mv',
    'nl',
    'python3',
    'readlink',
    'realpath',
    'rm',
    'sed',
    'sh',
    'sha256sum',
    'sleep',
    'sort',
    'stat',
    'tail',
    'tar',
    'tee',
    'touch',
    'tr',
    'uname',
    'uniq',
    'wc',
    'xargs',
)


def command(name: str) -> str:
    """Find a required test executable on PATH."""
    result = shutil.which(name)
    if result is None:
        message = f'Missing {name}; see tests/README.md for shell-test prerequisites.'
        raise SystemExit(message)
    return result


def copy_input(name: Path, workspace: Path) -> Path:
    """Copy one test input into a temporary directory."""
    source = ROOT / name
    if source.is_symlink():
        message = f'Expected a regular test input: {name}'
        raise SystemExit(message)
    destination = workspace / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination


def copy_fixture(name: Path, workspace: Path) -> None:
    """Rebase host-only fixture paths without changing shell line numbers."""
    destination = copy_input(name, workspace)
    if name in HOST_SCRIPTS:
        text = destination.read_text()
        text = HOST_PATH.sub(lambda match: '${BOTGE_TEST_ROOT:?}' + match[0], text)
        destination.write_text(re.sub(r'\bEUID\b', 'BOTGE_TEST_EUID', text))
    elif name == Path('scripts/ios/check-ios.sh'):
        text = destination.read_text()
        destination.write_text(
            text.replace('/usr/libexec/PlistBuddy', '${BOTGE_TEST_ROOT:?}/PlistBuddy')
        )


def check_report(report: Path, workspace: Path, files: list[Path]) -> bool:
    """Reject missing or below-threshold files using the raw line hit counts."""
    tree = ET.parse(report)  # noqa: S314 - kcov writes this report inside the temporary test workspace.
    coverage: dict[Path, dict[int, int]] = defaultdict(dict)
    for entry in tree.iter('class'):
        path = Path(entry.attrib['filename'])
        if path.is_absolute():
            if not path.is_relative_to(workspace):
                continue
            path = path.relative_to(workspace)
        for line in entry.findall('./lines/line'):
            number = int(line.attrib['number'])
            hits = int(line.attrib['hits'])
            coverage[path][number] = max(hits, coverage[path].get(number, 0))

    passed = True
    for path in files:
        counts = coverage.get(path, {})
        total = len(counts)
        covered = sum(hits > 0 for hits in counts.values())
        if total == 0:
            print(f'{path}: missing executable-line coverage')
            passed = False
            continue
        print(f'{path}: {covered}/{total} ({100 * covered / total:.1f}%)')
        if covered * 100 < total * MINIMUM:
            missed = ', '.join(str(number) for number, hits in sorted(counts.items()) if hits == 0)
            print(f'  Below {MINIMUM}%. Missed lines: {missed}')
            passed = False
    return passed


def shell_scripts() -> list[Path]:
    """Find repository shell scripts, including newly added source files."""
    tracked = subprocess.check_output(  # noqa: S603 - Fixed Git file inventory.
        (command('git'), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'),
        cwd=ROOT,
    )
    return sorted(
        {
            Path(os.fsdecode(name))
            for name in tracked.split(b'\0')
            if name.endswith(b'.sh') and (ROOT / os.fsdecode(name)).is_file()
        }
    )


def test_inputs(scripts: list[Path]) -> tuple[Path, ...]:
    """Collect the shell scripts, fixtures, and Bats suite."""
    return (
        *scripts,
        *map(Path, FIXTURES),
        *(path.relative_to(ROOT) for path in sorted((ROOT / 'tests/shell').glob('*.bats'))),
    )


def run_linux(scripts: list[Path], reports: Path) -> None:
    """Run one interpreter pass and one instrumented pass in a temporary workspace."""
    bats, kcov = (command(name) for name in ('bats', 'kcov'))
    inputs = test_inputs(scripts)
    reports.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='botge-shell-', dir='/tmp') as temporary:
        suite = Path(temporary)
        workspace = suite / 'work'
        tools = suite / 'bin'
        tools.mkdir()
        for name in TOOLS:
            (tools / name).symlink_to(command(name))
        output = suite / 'kcov'
        tests = (bats, '--print-output-on-failure', 'tests/shell')
        for instrumented in (False, True):
            for name in inputs:
                copy_fixture(name, workspace)
            environment = {
                'PATH': os.environ.get('PATH', os.defpath),
                'BOTGE_TEST_REPO': str(workspace),
                'BOTGE_TEST_TOOLS': str(tools),
                'BOTGE_SHELL_COVERAGE': '1' if instrumented else '0',
                'TMPDIR': str(suite),
            }
            invocation = tests
            if instrumented:
                invocation = (
                    kcov,
                    '--bash-dont-parse-binary-dir',
                    f'--include-path={workspace}',
                    f'--exclude-path={workspace / "tests/shell/helpers.bash"}',
                    str(output),
                    *tests,
                )
            subprocess.run(  # noqa: S603 - Fixed test commands and a private fixture tree.
                invocation, cwd=workspace, env=environment, check=True
            )
            shutil.rmtree(workspace)
        shutil.copytree(output, reports / 'kcov', dirs_exist_ok=True)
        if not check_report(output / 'bats/cobertura.xml', workspace, scripts):
            raise SystemExit(1)


def run_macos(scripts: list[Path], reports: Path) -> None:
    """Use the same Linux runner in a hardened container when running on macOS."""
    docker = command('docker')
    reports.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='botge-shell-macos-') as temporary:
        directory = Path(temporary).resolve()
        context = directory / 'image'
        for name in ('Dockerfile', 'Dockerfile.rego'):
            copy_input(Path('tests/shell') / name, context)
        subprocess.run(  # noqa: S603 - Fixed Buildx command and a minimal local context.
            (
                docker,
                'buildx',
                'build',
                '--load',
                '--tag',
                IMAGE,
                '--policy',
                'reset=true,filename=Dockerfile.rego,strict=true',
                '.',
            ),
            cwd=context / 'tests/shell',
            check=True,
        )
        inputs = directory / 'inputs'
        for name in test_inputs(scripts):
            copy_input(name, inputs)
        (inputs / 'shell-files').write_bytes(
            b''.join(os.fsencode(path) + b'\0' for path in scripts)
        )
        subprocess.run(  # noqa: S603 - Fixed container command with only test inputs and reports.
            (
                docker,
                'run',
                '--rm',
                '--network=none',
                '--cap-drop=ALL',
                '--security-opt=no-new-privileges',
                '--user',
                f'{os.getuid()}:{os.getgid()}',
                '--mount',
                f'type=bind,source={inputs},target=/inputs,readonly',
                '--mount',
                f'type=bind,source={reports},target=/reports',
                IMAGE,
                'python3',
                '/inputs/scripts/quality/run_shell_tests.py',
                '--container',
            ),
            check=True,
        )


def main() -> None:
    """Select the native Linux runner or its macOS container fallback."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', action='store_true', help=argparse.SUPPRESS)
    if parser.parse_args().container:
        scripts = [
            Path(os.fsdecode(name))
            for name in (ROOT / 'shell-files').read_bytes().split(b'\0')
            if name
        ]
        run_linux(scripts, Path('/reports'))
        return
    reports = ROOT / 'coverage/shell'
    if sys.platform == 'linux':
        run_linux(shell_scripts(), reports)
    elif sys.platform == 'darwin':
        run_macos(shell_scripts(), reports)
    else:
        message = 'Shell coverage requires Linux or macOS with Docker.'
        raise SystemExit(message)


if __name__ == '__main__':
    main()
