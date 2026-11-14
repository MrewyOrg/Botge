"""Verify documentation generation catches import failures without running helper entry points."""

import html
import tempfile
import unittest
from pathlib import Path

from doc_python import build


class DocumentationTests(unittest.TestCase):
    """Exercise generated output and failures using isolated modules."""

    def test_builds_api_pages_without_running_entry_points(self) -> None:
        """Render real docstrings and create a navigable index from import-safe modules."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sources = root / 'scripts'
            sources.mkdir()
            (sources / 'fixture.py').write_text(
                '"""Fixture documentation."""\n'
                'def add(value: int) -> int:\n'
                '    """Add one to the value."""\n'
                '    return value + 1\n'
                'if __name__ == "__main__":\n'
                '    raise RuntimeError("Entry point must not run")\n'
            )
            output = root / 'output'
            pages = build(root, output)
            self.assertEqual(pages, (output / 'fixture.html',))
            rendered = html.unescape(pages[0].read_text()).replace('\xa0', ' ')
            self.assertIn('Fixture documentation.', rendered)
            self.assertIn('Add one to the value.', rendered)
            self.assertIn('href="fixture.html"', (output / 'index.html').read_text())

    def test_failed_import_does_not_publish_or_accept_old_output(self) -> None:
        """A previous HTML file cannot hide an import failure in a later documentation build."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sources = root / 'scripts'
            sources.mkdir()
            (sources / 'broken.py').write_text('raise RuntimeError("fixture failure")\n')
            output = root / 'output'
            output.mkdir()
            (output / 'broken.html').write_text('old output')
            with self.assertRaisesRegex(SystemExit, 'Python documentation failed: broken'):
                build(root, output)
            self.assertEqual((output / 'broken.html').read_text(), 'old output')
            self.assertFalse((output / 'index.html').exists())


if __name__ == '__main__':
    unittest.main()
