"""Exercise helper failure paths with isolated files and deterministic command responses."""

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cache_references as cache
import check_python
import compare_benchmarks as bench
import doc_python
import doctor


class HelperPaths(unittest.TestCase):
    """Cover operational boundaries without real downloads, builds or service startup."""

    def test_docc_json_extract(self) -> None:
        """Render DocC JSON headings, lists, asides, tables, code and references offline."""
        page = {
            'metadata': {'title': 'Tab bars'},
            'abstract': [{'type': 'text', 'text': 'Navigate sections.'}],
            'references': {'doc://toolbars': {'title': 'Toolbars'}},
            'primaryContentSections': [
                {
                    'content': [
                        {'type': 'heading', 'level': 2, 'text': 'Best', 'anchor': 'Best'},
                        {
                            'type': 'paragraph',
                            'inlineContent': [
                                {
                                    'type': 'strong',
                                    'inlineContent': [{'type': 'text', 'text': 'Use '}],
                                },
                                {'type': 'codeVoice', 'code': 'TabView'},
                                {'type': 'text', 'text': ' or '},
                                {'type': 'reference', 'identifier': 'doc://toolbars'},
                                {'type': 'image', 'identifier': 'hidden.png'},
                            ],
                        },
                        {'type': 'paragraph', 'inlineContent': [{'type': 'image'}]},
                        {
                            'type': 'unorderedList',
                            'items': [
                                {
                                    'content': [
                                        {
                                            'type': 'paragraph',
                                            'inlineContent': [{'type': 'text', 'text': 'One'}],
                                        }
                                    ]
                                }
                            ],
                        },
                        {
                            'type': 'aside',
                            'name': 'Tip',
                            'content': [
                                {
                                    'type': 'paragraph',
                                    'inlineContent': [{'type': 'text', 'text': 'Hi'}],
                                }
                            ],
                        },
                        {
                            'type': 'table',
                            'rows': [
                                [
                                    [
                                        {
                                            'type': 'paragraph',
                                            'inlineContent': [{'type': 'text', 'text': 'A'}],
                                        }
                                    ],
                                    [],
                                ]
                            ],
                        },
                        {'type': 'codeListing', 'code': ['let x = 1']},
                        {'type': 'unknown'},
                    ]
                }
            ],
        }
        rendered = cache.docc_text(json.dumps(page).encode())
        self.assertEqual(
            rendered,
            '# Tab bars\nNavigate sections.\n\n## Best [Best]\nUse `TabView` or Toolbars\n'
            '- One\nTip: Hi\n| A |  |\n    let x = 1',
        )
        data = json.dumps(page).encode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = cache.Source(
                'page.json', 'https://example.invalid', hashlib.sha256(data).hexdigest(), 'page.txt'
            )
            with patch.object(cache, 'urlopen', return_value=io.BytesIO(data)):
                source.verify(root, offline=False)
            source.verify(root, offline=True)
            self.assertIn('## Best [Best]', (root / 'page.txt').read_text())

    def test_cache_download_extract_and_validation(self) -> None:
        """Verify visible HTML extraction, pinned downloads and corrupt/missing output rejection."""
        data = (
            b'<p>outside</p><main><h1 id="title">Title</h1><script>secret</script>'
            b'<style>x</style><p>Body</p></main><p>outside</p>'
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = cache.Source(
                'page.html', 'https://example.invalid', hashlib.sha256(data).hexdigest(), 'page.txt'
            )
            with patch.object(cache, 'urlopen', return_value=io.BytesIO(data)):
                source.verify(root, offline=False)
            source.verify(root, offline=True)
            source.verify(root, offline=False)
            rendered = (root / 'page.txt').read_text()
            self.assertIn('Body', rendered)
            self.assertNotIn('secret', rendered)
            for content in (None, 'stale'):
                (root / 'page.txt').unlink(missing_ok=True)
                if content is not None:
                    (root / 'page.txt').write_text(content)
                with self.assertRaises(SystemExit):
                    source.verify(root, offline=True)
            with self.assertRaises(SystemExit):
                source.verify_text(root / 'empty.txt', b'<p>outside</p>', offline=False)
            with patch.object(cache, 'MAX_BYTES', 1), self.assertRaises(SystemExit):
                source.verify(root, offline=True)
            for digest in ('bad', 'z' * 64):
                with self.assertRaises(SystemExit):
                    cache.Source.parse({'file': 'x', 'url': source.url, 'sha256': digest})
            for url in (
                'https://user:pass@example.invalid',
                'https://user@example.invalid',
                'https://',
            ):
                with self.assertRaises(SystemExit):
                    cache.Source.parse({'file': 'x', 'url': url, 'sha256': source.sha256})

    def test_cache_main_download_mode(self) -> None:
        """Resolve an actual manifest, create the cache and publish its verified source."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / 'scripts'
            scripts.mkdir()
            references = root / 'references'
            references.mkdir()
            data = b'<main><p>fixture</p></main>'
            (references / 'sources.json').write_text(
                json.dumps(
                    {
                        'files': [
                            {
                                'file': 'x.html',
                                'text': 'x.txt',
                                'url': 'https://example.invalid',
                                'sha256': hashlib.sha256(data).hexdigest(),
                            }
                        ]
                    }
                )
            )
            with (
                patch.object(cache, '__file__', str(scripts / 'cache_references.py')),
                patch.object(sys, 'argv', ['cache']),
                patch.object(cache, 'urlopen', return_value=io.BytesIO(data)),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                cache.main()
            self.assertEqual((references / 'cache/x.html').read_bytes(), data)

    def test_benchmark_fingerprint_tracks_workspace_sources(self) -> None:
        """Treat crate source and manifest edits as changes to benchmark identity."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            crate = root / 'crates' / 'domain'
            (crate / 'src').mkdir(parents=True)
            (crate / 'src' / 'lib.rs').write_text('fixture domain')
            (crate / 'Cargo.toml').write_text('fixture manifest')
            for name in ('Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'):
                (root / name).write_text('fixture')
            previous = Path.cwd()
            try:
                os.chdir(root)
                for relative in ('src/lib.rs', 'Cargo.toml'):
                    original = bench.fingerprint()
                    (crate / relative).write_text('changed')
                    self.assertNotEqual(original, bench.fingerprint())
            finally:
                os.chdir(previous)

    def test_benchmark_recording_and_corruption(self) -> None:
        """Record medians, refuse overwrites and detect changing sources or benchmark sets."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'crates/botge/src').mkdir(parents=True)
            for name in (
                'crates/botge/src/main.rs',
                'Cargo.toml',
                'Cargo.lock',
                'rust-toolchain.toml',
            ):
                (root / name).write_text('fixture')
            previous = Path.cwd()
            try:
                os.chdir(root)
                first = bench.fingerprint()
                (root / 'crates/botge/src/main.rs').write_text('changed')
                self.assertNotEqual(first, bench.fingerprint())
                output = root / 'record.json'

                def command(*args: str) -> str:
                    return 'test work ... bench: 1,200.00 ns/iter' if args[0] == 'sh' else 'fixture'

                with (
                    patch.object(bench, 'command', side_effect=command),
                    patch.object(bench.platform, 'processor', return_value=''),
                    contextlib.redirect_stdout(io.StringIO()),
                ):
                    bench.record_benchmarks(output, 2)
                    with self.assertRaises(SystemExit):
                        bench.record_benchmarks(output, 2)
                    original = json.loads(output.read_text())
                    recorded = bench.Results.load(output)
                    self.assertEqual(recorded.samples['work'], (1200.0, 1200.0))
                    self.assertEqual(recorded.metadata['cpu'], 'unknown')
                    corruptions: tuple[dict[str, object], ...] = (
                        {'rustflags': None},
                        {'runs': True},
                        {'runs': 0},
                        {'runs': 21},
                        {'samples': {}},
                        {'samples': {'work': [1]}},
                    )
                    for updates in corruptions:
                        output.write_text(json.dumps({**original, **updates}))
                        with self.assertRaises(SystemExit):
                            bench.Results.load(output)
                    output.unlink()
                    with (
                        patch.object(bench, 'fingerprint', side_effect=['before', 'after']),
                        self.assertRaises(SystemExit),
                    ):
                        bench.record_benchmarks(output, 1)
                    with (
                        patch.object(bench, 'command', return_value='no measurements'),
                        self.assertRaises(SystemExit),
                    ):
                        bench.record_benchmarks(output, 1)
                    with (
                        patch.object(
                            bench,
                            'command',
                            side_effect=[
                                'fixture',
                                'fixture',
                                'test one ... bench: 1 ns/iter',
                                'test two ... bench: 1 ns/iter',
                            ],
                        ),
                        self.assertRaises(SystemExit),
                    ):
                        bench.record_benchmarks(output, 2)
                with (
                    patch.object(bench.shutil, 'which', return_value=None),
                    self.assertRaises(SystemExit),
                ):
                    bench.command('missing')
                with (
                    patch.object(bench.shutil, 'which', return_value=sys.executable),
                    patch.object(bench.subprocess, 'check_output', return_value=' fixture '),
                ):
                    self.assertEqual(bench.command('python'), 'fixture')
                with self.assertRaises(SystemExit):
                    bench.compare(
                        bench.Results(dict.fromkeys(bench.MATCHING_METADATA, 'fixture'), {}),
                        bench.Results(
                            dict.fromkeys(bench.MATCHING_METADATA, 'fixture'), {'other': (1.0,)}
                        ),
                    )
            finally:
                os.chdir(previous)

    def test_entry_points_and_doctor_configuration_failures(self) -> None:
        """Run successful entry points and propagate failed gates without invoking real tools."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(doctor.diagnose(root, doctor.run, docker=False))
                (root / 'rust-toolchain.toml').write_text('[toolchain]\nchannel = false')
                (root / '.nvmrc').write_text('26')
                (root / '.python-version').write_text('3.15.2')
                (root / 'pyproject.toml').write_text('[tool.uv]\nrequired-version = "==0.13.8"')
                self.assertFalse(doctor.diagnose(root, doctor.run, docker=False))
                (root / 'rust-toolchain.toml').write_text('[toolchain]\nchannel = "nightly"')
                (root / 'pyproject.toml').write_text('[tool.uv]\nrequired-version = ">=0.13"')
                self.assertFalse(doctor.diagnose(root, doctor.run, docker=False))
                with (
                    patch.object(sys, 'argv', ['doctor']),
                    patch.object(doctor, 'diagnose', return_value=True),
                    self.assertRaisesRegex(SystemExit, '0'),
                ):
                    doctor.main()
                with (
                    patch.object(sys, 'argv', ['docs']),
                    patch.object(doc_python, 'build', return_value=()),
                ):
                    doc_python.main()
                with (
                    patch.object(sys, 'argv', ['compare', 'record', str(root / 'out')]),
                    patch.object(bench.os, 'chdir'),
                    patch.object(bench, 'record_benchmarks') as record,
                ):
                    bench.main()
                    record.assert_called_once()
                for status in (0, 1, None):
                    with (
                        patch.object(sys, 'argv', ['check']),
                        patch.object(
                            check_python.shutil,
                            'which',
                            return_value=None if status is None else sys.executable,
                        ),
                        patch.object(
                            check_python.subprocess,
                            'run',
                            return_value=doctor.Result(status or 0, ''),
                        ),
                    ):
                        if status == 0:
                            check_python.main()
                        else:
                            with self.assertRaises(SystemExit):
                                check_python.main()
            for name in ('empty', 'duplicate'):
                sources = root / name / 'scripts/quality'
                sources.mkdir(parents=True)
                if name == 'duplicate':
                    (sources / 'same.py').touch()
                    agents = root / name / '.agents/scripts'
                    agents.mkdir(parents=True)
                    (agents / 'same.py').touch()
                with self.assertRaises(SystemExit):
                    doc_python.build(root / name, root / 'output')
