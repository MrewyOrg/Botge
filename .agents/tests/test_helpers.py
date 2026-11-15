"""Exercise helper boundaries without network access or native benchmark execution."""

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _support import number, record, sequence, text

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


def invoke(script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run a known helper with test-controlled data arguments, never a shell."""
    return subprocess.run(  # noqa: S603 - Fixed Python executable and fixture helper path.
        [sys.executable, str(script), *args],
        capture_output=True,
        text=True,
        check=False,
    )


class BoundaryTests(unittest.TestCase):
    """Reject inputs that would corrupt manifests or benchmark comparisons."""

    def test_json_shapes_and_finite_measurements(self) -> None:
        """Reject non-object roots, non-string keys, invalid arrays and nonfinite timings."""
        invalid_objects: tuple[object, ...] = (None, [], {1: 'bad'})
        for value in invalid_objects:
            with self.subTest(value=value), self.assertRaises(SystemExit):
                record(value)
        invalid_arrays: tuple[object, ...] = (None, 'array', {})
        for value in invalid_arrays:
            with self.subTest(value=value), self.assertRaises(SystemExit):
                sequence(value)
        for value in (None, '', False):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                text(value)
        for value in (True, 0, -1, float('nan'), float('inf'), 10**1000, '12'):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                number(value)
        self.assertEqual(number(1.5), 1.5)
        self.assertEqual(record({'ok': [1]})['ok'], [1])

    def test_offline_cache_integrity_and_traversal_rejection(self) -> None:
        """Check absence, tampering and unsafe manifest paths without fetching anything."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / '.agents' / 'scripts'
            cache = root / '.agents' / 'references' / 'cache'
            scripts.mkdir(parents=True)
            cache.mkdir(parents=True)
            for name in ('cache_references.py', '_support.py'):
                shutil.copyfile(SCRIPTS / name, scripts / name)
            helper = scripts / 'cache_references.py'
            content = b'fixture license'
            item = {
                'file': 'license.txt',
                'url': 'https://example.invalid/license',
                'sha256': hashlib.sha256(content).hexdigest(),
            }
            manifest = cache.parent / 'sources.json'
            manifest.write_text(json.dumps({'files': [item]}))
            self.assertIn('Missing license.txt', invoke(helper, '--check').stderr)
            (cache / 'license.txt').write_bytes(b'changed')
            self.assertIn('Checksum mismatch', invoke(helper, '--check').stderr)
            (cache / 'license.txt').write_bytes(content)
            self.assertEqual(invoke(helper, '--check').returncode, 0)
            for invalid in ([], [item, item]):
                manifest.write_text(json.dumps({'files': invalid}))
                self.assertIn('unique cache filenames', invoke(helper, '--check').stderr)
            manifest.write_text(json.dumps({'files': [item]}))
            item['file'] = '../outside.txt'
            manifest.write_text(json.dumps({'files': [item]}))
            self.assertIn('filenames must be flat', invoke(helper, '--check').stderr)
            item['file'] = 'license.txt'
            item['url'] = 'file:///etc/passwd'
            manifest.write_text(json.dumps({'files': [item]}))
            self.assertIn('public HTTPS', invoke(helper, '--check').stderr)

    def test_benchmark_comparison_validates_metadata_and_samples(self) -> None:
        """Reject machine mismatches and bad timings before computing a median."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            before, after = root / 'before.json', root / 'after.json'
            original = {
                'system': 'fixture',
                'cpu': 'fixture',
                'arch': 'fixture',
                'rustc': 'fixture',
                'profile': 'bench',
                'rustflags': '',
                'runs': 1,
                'samples': {'work': [10.0]},
            }
            before.write_text(json.dumps(original))
            after.write_text(json.dumps({**original, 'samples': {'work': [5.0]}}))
            helper = SCRIPTS / 'compare_benchmarks.py'
            result = invoke(helper, 'compare', str(before), str(after))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('-50.0%', result.stdout)
            after.write_text(json.dumps({**original, 'arch': 'different'}))
            self.assertIn(
                'Incompatible benchmark metadata',
                invoke(helper, 'compare', str(before), str(after)).stderr,
            )
            after.write_text(json.dumps({**original, 'samples': {'work': [float('nan')]}}))
            self.assertIn(
                'finite and positive', invoke(helper, 'compare', str(before), str(after)).stderr
            )


if __name__ == '__main__':
    unittest.main()
