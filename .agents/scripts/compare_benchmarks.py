# cspell:words rustc
"""Record native benchmark medians without switching revisions or starting the bot.

Run record OUTPUT [RUNS] before and after a change, then compare BEFORE AFTER.
Record creates a new JSON file and runs Cargo benchmarks; compare only reads files.
Run from any directory. RUSTFLAGS is recorded as part of the comparison metadata.
"""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import statistics
import subprocess
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from collections.abc import Mapping

from _support import fail, number, read_json, record, sequence, text

MAX_RUNS = 20  # Bound an accidental repeat request; three runs is the normal comparison.
MATCHING_METADATA = ('system', 'cpu', 'arch', 'rustc', 'profile', 'rustflags')


def command(*args: str) -> str:
    """Run a program-defined argument vector without invoking a shell."""
    executable = shutil.which(args[0])
    if executable is None:
        fail(f'Missing executable: {args[0]}')
    # All callers supply fixed commands; CLI inputs are data paths, never command strings.
    return subprocess.check_output(  # noqa: S603
        (executable, *args[1:]),
        text=True,
        stderr=subprocess.STDOUT,
    ).strip()


def fingerprint() -> str:
    """Hash tracked and untracked Rust inputs so changing sources invalidate a recording."""
    digest = hashlib.sha256()
    paths = [
        *Path('src').rglob('*.rs'),
        Path('Cargo.toml'),
        Path('Cargo.lock'),
        Path('rust-toolchain.toml'),
    ]
    for path in sorted(paths):
        digest.update(str(path).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


@dataclass(frozen=True, slots=True)
class Results:
    """Validated machine metadata and immutable native timing samples."""

    metadata: Mapping[str, str]
    samples: Mapping[str, tuple[float, ...]]

    @classmethod
    def load(cls, path: Path) -> Results:
        """Reject malformed, empty, nonfinite or inconsistent benchmark recordings."""
        data = record(read_json(path))
        metadata = {key: text(data.get(key)) for key in MATCHING_METADATA if key != 'rustflags'}
        flags = data.get('rustflags')
        if not isinstance(flags, str):
            fail('Expected a RUSTFLAGS string')
        metadata['rustflags'] = flags
        samples = {
            name: tuple(number(item) for item in sequence(values))
            for name, values in record(data.get('samples')).items()
        }
        runs = data.get('runs')
        if isinstance(runs, bool) or not isinstance(runs, int) or not 1 <= runs <= MAX_RUNS:
            fail('Invalid benchmark run count')
        if not samples or any(not name or len(values) != runs for name, values in samples.items()):
            fail('Benchmark samples must match the recorded run count')
        return cls(MappingProxyType(metadata), MappingProxyType(samples))


class Recording(TypedDict):
    """The complete JSON recording schema, including mutable samples during measurement."""

    system: str
    cpu: str
    arch: str
    rustc: str
    profile: str
    rustflags: str
    commit: str
    diff_sha256: str
    runs: int
    samples: dict[str, list[float]]


def record_benchmarks(path: Path, runs: int) -> None:
    """Measure repeated native benchmarks and create a new recording file.

    Args:
        path: New output filename; existing files are never replaced.
        runs: Number of runs, validated by the CLI to be between one and MAX_RUNS.

    Raises:
        SystemExit: Measurements are missing, inputs change or the output already exists.
        OSError: Source or output files cannot be accessed.
        subprocess.CalledProcessError: A fixed build or metadata command fails.

    """
    if path.exists():
        fail('Use a new output path; benchmark recordings are never overwritten')
    state = fingerprint()
    samples: dict[str, list[float]] = {}
    metadata: Recording = {
        'system': platform.system(),
        'cpu': platform.processor() or 'unknown',
        'arch': platform.machine(),
        'rustc': command('rustc', '--version'),
        'profile': 'bench',
        'rustflags': os.environ.get('RUSTFLAGS', ''),
        'commit': command('git', 'rev-parse', 'HEAD'),
        'diff_sha256': state,
        'runs': runs,
        'samples': samples,
    }
    for index in range(runs):
        print(f'Benchmark run {index + 1}/{runs}', flush=True)
        output = command('sh', 'scripts/check-rust.sh', 'bench')
        matches = re.findall(
            r'^test (\S+)\s+\.\.\. bench:\s+([\d,.]+) ns/iter', output, re.MULTILINE
        )
        if not matches:
            fail('No benchmark measurements found.\n' + output)
        for name, value in matches:
            samples.setdefault(name, []).append(number(float(value.replace(',', ''))))
    if state != fingerprint() or any(len(values) != runs for values in samples.values()):
        fail('Source changed during recording or benchmark sets differed; discard this run')
    with path.open('x') as output:
        json.dump(metadata, output, indent=2)
        output.write('\n')
    print(f'Saved {len(samples)} benchmarks to {path}')


def compare(before: Results, after: Results) -> None:
    """Compare matching benchmark sets on matching machines and toolchains."""
    for key in MATCHING_METADATA:
        if before.metadata[key] != after.metadata[key]:
            fail(f'Incompatible benchmark metadata: {key}')
    if before.samples.keys() != after.samples.keys():
        fail('Benchmark sets differ; record matching sets before comparing')
    print('Benchmark | before ns | after ns | change (negative is faster)')
    for name, samples in before.samples.items():
        old = statistics.median(samples)
        new = statistics.median(after.samples[name])
        print(f'{name} | {old:.2f} | {new:.2f} | {(new / old - 1) * 100:+.1f}%')


def main() -> None:
    """Parse explicit record/compare commands without changing the checked-out revision."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    recorder = commands.add_parser('record')
    recorder.add_argument('file', type=Path)
    recorder.add_argument('runs', type=int, nargs='?', default=3, choices=range(1, MAX_RUNS + 1))
    comparer = commands.add_parser('compare')
    comparer.add_argument('before', type=Path)
    comparer.add_argument('after', type=Path)
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parents[2])
    if args.command == 'record':
        record_benchmarks(args.file, args.runs)
    else:
        compare(Results.load(args.before), Results.load(args.after))


if __name__ == '__main__':
    main()
