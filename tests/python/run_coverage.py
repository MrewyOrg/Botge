"""Run Python tests with subprocess coverage and enforce per-file line/branch budgets."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

import coverage

ROOT = Path(__file__).resolve().parents[2]
MINIMUM = 0.9


def meets_budget(*, covered: int, total: int) -> bool:
    """Accept complete empty categories, reject invalid counts and require at least 90%."""
    return 0 <= covered <= total and (total == 0 or covered / total >= MINIMUM)


def main() -> None:
    """Measure fresh data, normalize copied fixtures and fail any helper below 90%."""
    output = ROOT / 'coverage' / 'python'
    output.mkdir(parents=True, exist_ok=True)
    sources = sorted(
        (
            *ROOT.glob('scripts/**/*.py'),
            *ROOT.glob('.agents/scripts/*.py'),
            *ROOT.glob('quantum/proofs/symbolic/*.py'),
            *ROOT.glob('chemistry/proofs/symbolic/*.py'),
        )
    )
    sys.path[:0] = sorted({str(path.parent) for path in sources})
    with tempfile.TemporaryDirectory(prefix='data-', dir=output) as temporary:
        directory = Path(temporary)
        configuration = directory / 'coverage.ini'
        configuration.write_text(
            '[run]\nbranch = True\nparallel = True\npatch = subprocess\ndata_file = '
            + str(directory / '.coverage')
            + '\ninclude =\n'
            + ''.join(f'    */{path.name}\n' for path in sources)
            + '\n[paths]\nagent =\n    '
            + str(ROOT / '.agents/scripts')
            + '\n    */.agents/scripts\n\n[report]\nprecision = 2\nshow_missing = True\n'
        )
        measured = coverage.Coverage(config_file=str(configuration), data_suffix=True)
        measured.start()
        suites = [
            unittest.TestLoader().discover(str(ROOT / path))
            for path in (
                'tests/python',
                '.agents/tests',
                'quantum/proofs/symbolic/tests',
                'chemistry/proofs/symbolic/tests',
            )
        ]
        result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(suites))
        measured.stop()
        measured.save()
        combined = coverage.Coverage(config_file=str(configuration), data_suffix=False)
        combined.combine(strict=True)
        if not combined.get_data().has_arcs():
            message = 'Python branch coverage is missing'
            raise SystemExit(message)
        combined.get_data().touch_files([str(path) for path in sources])
        combined.save()
        combined.report()
        combined.json_report(outfile=str(output / 'coverage.json'))
        combined.html_report(directory=str(output / 'html'))
        report = json.loads((output / 'coverage.json').read_text())
        failed = not result.wasSuccessful()
        for path in sources:
            summary = report['files'][str(path.relative_to(ROOT))]['summary']
            for category, total in (('lines', 'num_statements'), ('branches', 'num_branches')):
                count = summary[total]
                covered = summary[f'covered_{category}']
                if not meets_budget(covered=covered, total=count):
                    print(f'{path.relative_to(ROOT)} {category}: {covered}/{count} below 90%')
                    failed = True
        raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
