"""Exercise Swift documentation tag rules on temporary source trees."""

import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_swift_docs as docs


def tree(root: Path, source: str) -> Path:
    """Write one framework source file and return its path."""
    path = root / 'ios' / 'BotgeKit' / 'Sample.swift'
    path.parent.mkdir(parents=True)
    path.write_text(source, encoding='utf-8')
    return path


class SwiftDocs(unittest.TestCase):
    """Require tags unless the comment already names or describes each item."""

    def findings(self, source: str) -> list[str]:
        """Check `source` as a framework file and return the finding messages."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree(root, source)
            return [finding.message for finding in docs.check(root)]

    def test_untagged_parameters_and_results_are_reported(self) -> None:
        """Report each undocumented parameter and a missing result tag."""
        source = (
            '/// Adds numbers.\n'
            '@discardableResult\n'
            'public static func add(_ first: Int, to second: Int) -> Int {\n'
            '  first + second\n'
            '}\n'
        )
        self.assertEqual(
            self.findings(source),
            [
                'document parameter `first`',
                'document parameter `second`',
                'document the result with `- Returns:`',
            ],
        )

    def test_tags_backticked_names_and_described_results_pass(self) -> None:
        """Accept tags, names in backticks, `Whether` summaries and unnamed parameters."""
        source = (
            '/// Sums values.\n'
            '///\n'
            '/// - Parameters:\n'
            '///   - first: The first value.\n'
            '///   - second: The second value.\n'
            '/// - Returns: The sum.\n'
            'func sum(\n'
            '  first: Int,\n'
            '  second: [String: Int]\n'
            ') -> Int where Int: Sendable {\n'
            '  0\n'
            '}\n'
            '\n'
            '/// Whether `value` is even.\n'
            'func isEven(_ value: Int) -> Bool { value % 2 == 0 }\n'
            '\n'
            '/// Creates a sample with `name`.\n'
            'init(name: String) {}\n'
            '\n'
            '/// - Parameter count: How many.\n'
            'mutating func repeatCount(count: Int) {}\n'
            '\n'
            '/// Answers every request.\n'
            'func data(for _: URLRequest) -> Void {}\n'
            '\n'
            'func undocumented(value: Int) -> Int { value }\n'
            '\n'
            '/// Returns the text.\n'
            'subscript(index: Int) -> String { "" }\n'
        )
        self.assertEqual(self.findings(source), ['document parameter `index`'])

    def test_unterminated_signatures_and_main_report_findings(self) -> None:
        """Read truncated signatures and exit with status 1 when tags are missing."""
        self.assertEqual(docs.signature(['func broken(value: Int'], 0)[0], 'value: Int')
        self.assertIsNone(docs.result_type(' throws'))
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tree(root, '/// Uses a value.\nfunc use(value: Int) {}\n')
            output = io.StringIO()
            with (
                patch.object(docs, 'ROOT', root),
                patch('sys.argv', ['check_swift_docs.py']),
                contextlib.redirect_stderr(output),
                self.assertRaises(SystemExit) as raised,
            ):
                docs.main()
            self.assertEqual(raised.exception.code, 1)
            self.assertIn(
                'ios/BotgeKit/Sample.swift:2: document parameter `value`', output.getvalue()
            )
            (root / 'ios' / 'BotgeKit' / 'Sample.swift').write_text(
                '/// Uses `value`.\nfunc use(value: Int) {}\n'
            )
            with (
                patch.object(docs, 'ROOT', root),
                patch('sys.argv', ['check_swift_docs.py']),
                self.assertRaises(SystemExit) as raised,
            ):
                docs.main()
            self.assertEqual(raised.exception.code, 0)


if __name__ == '__main__':
    unittest.main()
