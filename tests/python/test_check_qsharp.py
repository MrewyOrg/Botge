"""Exercise the Q# check with fake QDK contexts, so no Q# compiler or simulator runs."""

import contextlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
import warnings
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast
from unittest.mock import patch

import check_qsharp as qs

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / 'scripts' / 'quantum' / 'check_qsharp.py'
TAG = re.compile(r'"(__QCOV_[SB]__:[^"]+)"')
STRICT_LINTS: list[dict[str, str]] = [
    {'group': 'deprecations', 'level': 'error'},
    *({'lint': name, 'level': 'error'} for name in qs.REQUIRED_LINTS),
]
# A callable that reaches every instrumentation path: Fact guards, if with and without else,
# ranged and unranged loops, a ternary, a multi-line call and a closing argument list.
FIXTURE = """import Std.Diagnostics.Fact;

/// # Summary
/// Fixture operation.
operation Run(n : Int, reg : Qubit[]) : Int {
    Fact(n >= 1, "n must be positive.");
    Fact(n < 9, message);
    mutable total = 0;
    if n > 1 {
        total += 1;
    } else {
        total += 2;
    }
    if n > 2 {
        H(reg[0]);
    }
    for i in 0..n - 1 {
        H(reg[i]);
    }
    for q in reg {
        X(q);
    }
    let pick = n > 3 ? 1 | 2;
    // A comment line.
    Helper(
        n
    );
    return total + pick;
}

function Outside() : Unit {}
"""


class QSharpError(Exception):
    """Stands in for `qdk.qsharp.QSharpError`."""


class TestCallable:
    """A Q# `@Test()` callable as the QDK exposes it."""

    __is_test__ = True

    def __call__(self) -> None:
        """Do nothing; the fake context decides what a run returns."""


def guard() -> None:
    """Stand in for a non-test Q# callable."""


type Behaviour = Callable[[object, tuple[object, ...]], list[dict[str, object]]]


class FakeContext:
    """A `qdk.Context` whose runs are answered by `behaviour`."""

    def __init__(self, code: object, behaviour: Behaviour) -> None:
        """Expose `code` and answer runs with `behaviour`."""
        self.code = cast('qs.QdkCodeRoot', code)
        self.behaviour = behaviour
        self.evaluated: list[str] = []
        self.runs: list[tuple[object, tuple[object, ...]]] = []
        self.compiled: list[tuple[object, ...]] = []

    def eval(self, source: str, *, save_events: bool = False) -> object:
        """Record evaluated Q# source."""
        del save_events
        self.evaluated.append(source)
        return None

    def run(
        self,
        entry_expr: object,
        shots: int,
        *args: object,
        save_events: bool = False,
        seed: int | None = None,
    ) -> list[dict[str, object]]:
        """Record the call and return or raise what `behaviour` decides."""
        del shots, save_events, seed
        self.runs.append((entry_expr, args))
        return self.behaviour(entry_expr, args)

    def compile(self, entry_expr: object, *args: object) -> object:
        """Return Base QIR with the `prop:compile` gate tally for `(n_b, n_o, L)`."""
        del entry_expr
        self.compiled.append(args)
        base_bits, overlay_bits = cast('tuple[int, int]', args[:2])
        return fake_qir(base_bits, overlay_bits)


def fake_qir(
    base_bits: int,
    overlay_bits: int,
    *,
    profile: str = 'base_profile',
    extra_rzz: int = 0,
) -> str:
    """Build QIR text with one call per gate the circuit applies."""
    width = base_bits + overlay_bits
    gates = {'h': width, 'rzz': base_bits * overlay_bits + extra_rzz, 'rx': width, 'm': width}
    calls = [
        f'  call void @__quantum__qis__{gate}__body(%Qubit* null)'
        for gate, count in gates.items()
        for _ in range(count)
    ]
    attributes = f'attributes #0 = {{ "entry_point" "qir_profiles"="{profile}" }}'
    return '\n'.join(
        ['define void @ENTRYPOINT__main() #0 {', *calls, '  ret void', '}', attributes]
    )


def fail_every_guard(_: object, args: tuple[object, ...]) -> list[dict[str, object]]:
    """Reject every call with all guard messages, as invalid arguments would."""
    messages = sorted({case[3] for case in qs.STACK_GUARD_CASES})
    raise QSharpError(f'{args}: ' + ' '.join(messages))


def namespace(tests: int = qs.MIN_QSHARP_TESTS) -> SimpleNamespace:
    """Build a `context.code` tree with `tests` test callables and the guard entry points."""
    callables = {f'Test{index}': TestCallable() for index in range(tests)}
    return SimpleNamespace(
        BotgeQuantum=SimpleNamespace(EntangleStack=guard, **callables),
        RunCircuitGuard=guard,
        CovRunStackGuard=guard,
        CovRunCircuitGuard=guard,
    )


def print_passed(**_: object) -> None:
    """Report a passing Q# test run."""
    print('3 passed')


def no_shots(*_: object) -> list[dict[str, object]]:
    """Return no shots, as a run that passes every guard would."""
    return []


def constant(context: FakeContext) -> Callable[..., FakeContext]:
    """Build a context factory that always returns `context`."""

    def factory(**_: object) -> FakeContext:
        return context

    return factory


def modules(factory: Callable[..., FakeContext], run_tests: object = None) -> qs.QdkModules:
    """Fake QDK modules around a context factory."""
    return qs.QdkModules(
        context_cls=cast('qs.ContextFactory', factory),
        target_base='base',
        qsharp_error=QSharpError,
        run_tests=cast('qs.RunTestsCallable', run_tests or print_passed),
    )


@contextlib.contextmanager
def project(*files: tuple[str, str]) -> Generator[Path]:
    """Point the check's path constants at a temporary `quantum/` project."""
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / 'quantum'
        (root / 'src').mkdir(parents=True)
        for name, text in files:
            (root / name).parent.mkdir(parents=True, exist_ok=True)
            (root / name).write_text(text, encoding='utf-8')
        with (
            patch.object(qs, 'REPO_ROOT', Path(temporary)),
            patch.object(qs, 'QUANTUM_ROOT', root),
            patch.object(qs, 'SRC_DIR', root / 'src'),
            patch.object(qs, 'COVERAGE_OUT', Path(temporary) / 'coverage.json'),
        ):
            yield root


def manifest(**fields: object) -> tuple[str, str]:
    """Build the Base `qsharp.json` with strict defaults overridden by `fields`."""
    data: dict[str, object] = {'targetProfile': 'base', 'lints': STRICT_LINTS}
    data.update(fields)
    return 'qsharp.json', json.dumps(data)


class ManifestTests(unittest.TestCase):
    """Check the `qsharp.json` audit."""

    def test_repository_manifest_is_strict(self) -> None:
        """The committed manifest passes and targets Base."""
        self.assertEqual(qs.verify_manifest()['targetProfile'], 'base')

    def test_lint_entries_need_objects_and_levels(self) -> None:
        """Lint and group levels are collected; malformed entries stop the check."""
        levels, groups = qs.parse_lint_entries(
            [{'lint': 'a', 'level': 'error'}, {'group': 'g', 'level': 'warn'}, {'level': 'x'}]
        )
        self.assertEqual((levels, groups), ({'a': 'error'}, {'g': 'warn'}))
        with self.assertRaisesRegex(SystemExit, 'must be an object'):
            qs.parse_lint_entries(['needlessParens'])
        with self.assertRaisesRegex(SystemExit, 'string level'):
            qs.parse_lint_entries([{'lint': 'a', 'level': 2}])

    def test_manifest_rejects_weak_settings(self) -> None:
        """Each missing strict setting is reported."""
        weak = [entry for entry in STRICT_LINTS if entry.get('lint') != 'doubleEquality']
        cases = (
            (('qsharp.json', '[]'), 'JSON object'),
            (manifest(targetProfile='unrestricted'), 'must set "targetProfile": "base"'),
            (manifest(lints={}), 'strict lint rules'),
            (manifest(lints=STRICT_LINTS[1:]), 'deprecations'),
            (manifest(lints=weak), 'lints: doubleEquality'),
        )
        for file, message in cases:
            with self.subTest(message=message), project(file):
                self.assertRaisesRegex(SystemExit, message, qs.verify_manifest)


class LintTests(unittest.TestCase):
    """Check the static Q# lint rules."""

    def test_comments_are_stripped_outside_strings(self) -> None:
        """`//` inside a string, even after an escaped quote, is kept."""
        self.assertEqual(qs.strip_qsharp_comments('let x = 1; // note'), 'let x = 1; ')
        self.assertEqual(qs.strip_qsharp_comments('Message("a // b");'), 'Message("a // b");')
        line = 'Message("say \\" // still text"); // gone'
        self.assertEqual(qs.strip_qsharp_comments(line), 'Message("say \\" // still text"); ')

    def test_doc_summary_may_precede_attributes(self) -> None:
        """A `/// # Summary` block counts through attributes but not across code."""
        lines = ['/// # Summary', '/// Text.', '@Test()', 'operation A() : Unit {}']
        self.assertTrue(qs.has_doc_summary(lines, 4))
        self.assertFalse(qs.has_doc_summary(['/// Text.', 'operation A() : Unit {}'], 2))
        self.assertFalse(qs.has_doc_summary(['let x = 1;', 'operation A() : Unit {}'], 2))

    def test_repository_sources_are_clean(self) -> None:
        """The committed Q# sources pass every static rule."""
        sources = sorted(qs.SRC_DIR.rglob('*.qs'))
        self.assertEqual(
            [path.name for path in sources], ['BotgeQuantum.qs', 'BotgeQuantumTests.qs']
        )
        self.assertEqual(qs.lint_qsharp_sources(sources), [])

    def test_lint_reports_each_rule(self) -> None:
        """Violations are reported with repository-relative locations."""
        source = (
            'namespace Old {\n'
            'open Std.Math;\n'
            'operation Undocumented() : Unit {\n'
            '    set x = 1;\n'
            '    let y = x w/ 0 <- 1;\n'
            '    let z = 1 / 0;\n'
            '    let a = b = c;\n'
            '    let d = e == 1.0;;\n'
            '    let f = (g);\n'
            '    // set ignored = 1;\n'
            '}\n'
        )
        with project(('src/Bad.qs', source)) as root:
            errors = qs.lint_qsharp_sources([root / 'src' / 'Bad.qs'])
        for expected in (
            'quantum/src/Bad.qs:1: avoidNamespaceBlock',
            'quantum/src/Bad.qs:2: deprecated `open` (use `import`)',
            'quantum/src/Bad.qs:3: callable `Undocumented` missing /// # Summary',
            'quantum/src/Bad.qs:4: deprecatedSet',
            'quantum/src/Bad.qs:5: deprecatedWithOrUpdateExpr',
            'quantum/src/Bad.qs:6: divisionByZero',
            'quantum/src/Bad.qs:7: discourageChainAssignment',
            'quantum/src/Bad.qs:8: doubleEquality',
            'quantum/src/Bad.qs:8: redundantSemicolons',
            'quantum/src/Bad.qs:9: needlessParens on binding RHS',
        ):
            self.assertIn(expected, errors)
        self.assertFalse([error for error in errors if ':10:' in error])


class InstrumentationTests(unittest.TestCase):
    """Check the Q# coverage instrumentation."""

    def test_statement_detection(self) -> None:
        """Statements end in `;` or `{` or start a binding; closing argument lists do not count."""
        for line, expected in (
            ('', False),
            ('// note', False),
            ('H(q);', True),
            ('if x {', True),
            ('let x =', True),
            ('n', False),
            (');', False),
            ('Foo(a, b);', True),
            ('let x = f(a);', True),
        ):
            with self.subTest(line=line):
                self.assertEqual(qs.is_executable_statement(line), expected)

    def test_repository_source_probe_counts(self) -> None:
        """The production file has the probe counts the coverage report uses."""
        source = qs.SRC_DIR / 'BotgeQuantum.qs'
        text, statements, branches, facts = qs.instrument_qsharp_file(source, 'src/x.qs')
        self.assertEqual((len(statements), len(branches)), (23, 10))
        self.assertEqual(len(facts), 4)
        self.assertIn(qs.COV_HELPERS.splitlines()[0], text)

    def test_unmodeled_control_flow_stops_instrumentation(self) -> None:
        """`elif`, loops other than `for`, conjugations and multi-line headers fail closed."""
        header = '/// # Summary\n/// Probe.\nfunction F(a : Int) : Int {\n    mutable r = 0;\n'
        for body, keyword in (
            (
                '    if a > 1 {\n        r += 1;\n    } elif a > 0 {\n        r += 2;\n    }\n',
                'elif',
            ),
            ('    while r < a {\n        r += 1;\n    }\n', 'while'),
            ('    repeat {\n        r += 1;\n    } until r > a;\n', 'repeat'),
            ('    within {\n        r += 1;\n    } apply {\n        r += 2;\n    }\n', 'within'),
            ('    if a > 1\n    {\n        r += 1;\n    }\n', 'if'),
        ):
            with (
                self.subTest(keyword=keyword),
                project(('src/Probe.qs', header + body + '    return r;\n}\n')) as root,
                self.assertRaisesRegex(SystemExit, f'do not model `{keyword}`'),
            ):
                qs.instrument_qsharp_file(root / 'src' / 'Probe.qs', 'src/Probe.qs')

    def test_fixture_probes_every_construct(self) -> None:
        """Each construct gets its statement probe and both branch tags."""
        with project(('src/Fixture.qs', FIXTURE)) as root:
            text, statements, branches, facts = qs.instrument_qsharp_file(
                root / 'src' / 'Fixture.qs', 'src/Fixture.qs'
            )
        lines = text.splitlines()
        self.assertEqual(statements, {6, 7, 8, 9, 10, 12, 14, 15, 17, 18, 20, 21, 23, 28})
        self.assertEqual(
            branches,
            {f'{line}:{side}' for line in (6, 7, 9, 14, 17, 23) for side in 'TF'} | {'20:T'},
        )
        self.assertEqual(sorted(facts.values()), [6, 7])
        for line_number in facts:
            self.assertTrue(lines[line_number - 1].strip().startswith('Fact('))
        tags = set(TAG.findall(text))
        self.assertIn('__QCOV_B__:src/Fixture.qs:17:F', tags)
        self.assertIn('__QCOV_B__:src/Fixture.qs:23:T', tags)
        self.assertIn('__QCOV_B__:src/Fixture.qs:14:F', tags)
        self.assertNotIn('__QCOV_B__:src/Fixture.qs:20:F', tags)
        self.assertIn('    } else {', lines)
        self.assertEqual(lines[-1], 'function Outside() : Unit {}')

    def test_collects_nested_test_callables(self) -> None:
        """Test callables are found in nested namespaces; other callables are skipped."""
        code = namespace(tests=3)
        self.assertEqual(len(qs.collect_test_callables(code)), 3)

    def test_records_only_matching_file_tags(self) -> None:
        """Statement and branch tags for other files are ignored."""
        statements: set[int] = set()
        branches: set[str] = set()
        qs.record_messages(
            ['__QCOV_S__:src/a.qs:4', '__QCOV_B__:src/a.qs:5:T', '__QCOV_S__:src/b.qs:9', 'hi'],
            'src/a.qs',
            statements,
            branches,
        )
        self.assertEqual((statements, branches), ({4}, {'5:T'}))


class QirTests(unittest.TestCase):
    """Check the Base QIR compilation gate."""

    def test_gate_counts_parse_quantum_calls(self) -> None:
        """Only `__quantum__qis__*__body` calls count, grouped by gate."""
        qir = fake_qir(2, 1) + '\n  call void @__quantum__rt__initialize(i8* null)'
        self.assertEqual(qs.qir_gate_counts(qir), {'h': 3, 'rzz': 2, 'rx': 3, 'm': 3})

    def test_repository_widths_compile_with_the_gate_tally(self) -> None:
        """Every width is compiled; the tally matches `n_b n_o + 2 (n_b + n_o)`."""
        context = FakeContext(namespace(), no_shots)
        qs.verify_base_qir(context)
        self.assertEqual(context.compiled, list(qs.QIR_WIDTHS))

    def test_rejects_other_profiles_and_gate_counts(self) -> None:
        """A non-Base profile or an extra gate fails the check."""
        for qir, message in (
            (fake_qir(10, 6, profile='adaptive_profile'), 'did not compile to Base QIR'),
            (fake_qir(10, 6, extra_rzz=1), 'QIR gates .* differ'),
        ):
            context = FakeContext(namespace(), no_shots)
            with (
                self.subTest(message=message),
                patch.object(context, 'compile', return_value=qir),
                self.assertRaisesRegex(SystemExit, message),
            ):
                qs.verify_base_qir(context)


class GuardTests(unittest.TestCase):
    """Check `Fact` guard assertions against fake contexts."""

    def test_assert_fact_failure_outcomes(self) -> None:
        """The expected error passes; another error or a successful run fails."""
        failing = FakeContext(namespace(), fail_every_guard)
        qs.assert_fact_failure(failing, guard, QSharpError, (0,), 'steps must be')
        with self.assertRaisesRegex(SystemExit, 'Unexpected error'):
            qs.assert_fact_failure(failing, guard, QSharpError, (0,), 'other text')
        passing = FakeContext(namespace(), no_shots)
        with self.assertRaisesRegex(SystemExit, 'Expected Fact failure'):
            qs.assert_fact_failure(passing, guard, QSharpError, (1,), 'steps must be')

    def test_guard_assertions_cover_both_entry_points(self) -> None:
        """Every case runs on `EntangleStack` and on the circuit wrapper, compiled under Base."""
        contexts: list[FakeContext] = []

        def factory(**_: object) -> FakeContext:
            contexts.append(FakeContext(namespace(), fail_every_guard))
            return contexts[-1]

        main = FakeContext(namespace(), fail_every_guard)
        qs.run_fact_guard_assertions(modules(factory), main)
        cases = len(qs.STACK_GUARD_CASES)
        self.assertEqual((len(main.runs), len(contexts[0].runs)), (cases, cases))
        self.assertIn('import BotgeQuantum.ApplyIsingRxCircuit;', contexts[0].evaluated[0])
        self.assertIn('operation RunCircuitGuard', contexts[0].evaluated[0])

    def test_instrumented_guards_record_false_branches(self) -> None:
        """Stack frames on a mapped `Fact` line record its false branch; others are ignored."""
        frames: dict[tuple[object, ...], str] = {
            (0, 1, 1): 'at Run in /tmp/q/src/a.qs:12:5',
            (11, 1, 1): 'at Run in /tmp/q/src/a.qs:99:5',
            (1, 0, 1): 'at Run in /tmp/q/src/other.qs:12:5',
        }

        def behaviour(_: object, args: tuple[object, ...]) -> list[dict[str, object]]:
            if args in frames:
                message = f'Error: failed\n{frames[args]}'
                raise QSharpError(message)
            return []

        context = FakeContext(namespace(), behaviour)
        hits: dict[str, set[str]] = {'src/a.qs': set()}
        qs.exercise_instrumented_fact_guards(
            modules(constant(context)), context, {'src/a.qs': {12: 6}}, hits
        )
        self.assertEqual(hits, {'src/a.qs': {'6:F'}})
        self.assertEqual(len(context.runs), 2 * len(qs.STACK_GUARD_CASES))
        self.assertEqual(len(context.evaluated), 2)
        self.assertIn('import BotgeQuantum.EntangleStack;', context.evaluated[0])
        self.assertIn('operation CovRunCircuitGuard', context.evaluated[1])


class CoverageTests(unittest.TestCase):
    """Check the coverage gate and its report."""

    @staticmethod
    def simulated(root: Path) -> FakeContext:
        """Emit every probe of the instrumented copy and fail its `Fact` lines."""
        source = root / 'src' / 'Fixture.qs'
        text = source.read_text(encoding='utf-8')
        messages: list[object] = [tag for tag in TAG.findall(text) if not tag.endswith(':23:F')]
        fact_lines = [
            number
            for number, line in enumerate(text.splitlines(), start=1)
            if line.strip().startswith('Fact(')
        ]
        code = namespace(tests=1)

        def behaviour(entry: object, args: tuple[object, ...]) -> list[dict[str, object]]:
            if entry is guard and args and args[0] in {0, 11}:
                lines = '\n'.join(f'at Run in {source}:{line}:5' for line in fact_lines)
                raise QSharpError(lines.replace(str(root) + '/', '/x/'))
            return [{'messages': messages}, {}]

        return FakeContext(code, behaviour)

    def test_gate_measures_the_instrumented_copy(self) -> None:
        """Probes come from a Base copy; the original sources stay untouched."""
        roots: list[str] = []

        def simulate(**kwargs: object) -> FakeContext:
            roots.append(str(kwargs['project_root']))
            self.assertEqual(kwargs['target_profile'], 'base')
            return self.simulated(Path(roots[-1]))

        with project(manifest(), ('src/Fixture.qs', FIXTURE), ('src/FixtureTests.qs', '')) as root:
            summaries = qs.run_coverage_gate(modules(simulate))
            self.assertEqual((root / 'src' / 'Fixture.qs').read_text(encoding='utf-8'), FIXTURE)
        self.assertTrue(roots[0].endswith('/quantum'))
        summary = summaries['src/Fixture.qs']
        self.assertEqual((summary.statements_covered, summary.statements_total), (14, 14))
        self.assertEqual((summary.branches_covered, summary.branches_total), (12, 13))
        self.assertEqual(summary.missing_branches, ('23:F',))
        self.assertEqual(list(summaries), ['src/Fixture.qs'])

    def test_gate_requires_production_sources(self) -> None:
        """A project with only test files has nothing to measure."""
        with project(('src/OnlyTests.qs', '')), self.assertRaisesRegex(SystemExit, 'No production'):
            qs.run_coverage_gate(modules(constant(FakeContext(namespace(), fail_every_guard))))

    def test_copy_skips_proofs_and_other_files(self) -> None:
        """Only the manifest and `src/` are copied; `proofs/` and its Lake cache are not."""
        with (
            project(
                manifest(),
                ('src/A.qs', 'a'),
                ('src/ATests.qs', 'b'),
                ('proofs/lean/.lake/huge.olean', 'x'),
                ('server.py', ''),
            ) as root,
            tempfile.TemporaryDirectory() as temporary,
        ):
            qs.copy_qsharp_project(Path(temporary))
            copied = sorted(
                str(path.relative_to(temporary))
                for path in Path(temporary).rglob('*')
                if path.is_file()
            )
            self.assertTrue((root / 'proofs').is_dir())
        self.assertEqual(copied, ['qsharp.json', 'src/A.qs', 'src/ATests.qs'])

    def test_report_is_written_and_enforced(self) -> None:
        """The JSON report is written; one missed statement or branch fails after printing it."""
        good = qs.CoverageSummary(10, 10, 10, 10, (), ())
        missed_statement = qs.CoverageSummary(9, 10, 10, 10, (3,), ())
        missed_branch = qs.CoverageSummary(10, 10, 9, 10, (), ('4:F',))
        with project() as root:
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                qs.write_and_enforce_coverage({'src/a.qs': good})
            report = json.loads((root.parent / 'coverage.json').read_text(encoding='utf-8'))
            self.assertEqual(report['src/a.qs']['statement_pct'], 100.0)
            self.assertNotIn('missing', stdout.getvalue())
            for summary, gap in (
                (missed_statement, 'missing statements: [3]'),
                (missed_branch, "missing branches: ['4:F']"),
            ):
                with (
                    self.subTest(gap=gap),
                    contextlib.redirect_stdout(io.StringIO()) as stdout,
                    self.assertRaisesRegex(SystemExit, 'below 100%'),
                ):
                    qs.write_and_enforce_coverage({'src/a.qs': good, 'src/b.qs': summary})
                self.assertIn(gap, stdout.getvalue())


class LanguageServiceTests(unittest.TestCase):
    """Check the npm `qsharp-lang` version gate and the language-service lint step."""

    def check_package(self, text: str | None, qdk_version: str = '1.34.0') -> str:
        """Run the version gate against a temporary `qsharp-lang/package.json`."""
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / 'package.json'
            if text is not None:
                package.write_text(text, encoding='utf-8')
            with (
                patch.object(qs, 'LANGUAGE_PACKAGE', package),
                patch.object(qs.importlib.metadata, 'version', return_value=qdk_version),
            ):
                return qs.verify_language_package()

    def test_language_package_must_match_qdk(self) -> None:
        """The npm linter must ship the same compiler version as the Python `qdk`."""
        self.assertEqual(self.check_package('{"version": "1.34.0"}'), '1.34.0')
        for text, message in (
            (None, 'run `npm ci`'),
            ('{"version": "1.33.0"}', 'qsharp-lang 1.33.0 must match qdk 1.34.0'),
            ('[]', 'qsharp-lang None must match qdk 1.34.0'),
        ):
            with self.subTest(text=text), self.assertRaisesRegex(SystemExit, message):
                self.check_package(text)

    def test_repository_runs_the_typescript_linter(self) -> None:
        """The lint script sits beside the check and lints `quantum/` with the resolved Node."""
        self.assertTrue(qs.LINT_SCRIPT.is_file())
        done = subprocess.CompletedProcess(args=(), returncode=0, stdout='Q# lints clean\n')
        with (
            patch.object(qs.shutil, 'which', return_value='/bin/node'),
            patch.object(qs.subprocess, 'run', return_value=done) as run,
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            qs.run_language_service_lints()
        self.assertEqual(
            run.call_args.args[0], ('/bin/node', str(qs.LINT_SCRIPT), str(qs.QUANTUM_ROOT))
        )
        self.assertEqual(stdout.getvalue(), 'Q# lints clean\n')

    def test_lint_failures_and_missing_node_stop_the_check(self) -> None:
        """Findings, a silent failure, or no Node on `PATH` each stop the check."""
        for stdout, stderr, message in (
            ('src/A.qs:1:1: error: unnecessary parentheses (base)\n', '', 'unnecessary paren'),
            ('', 'Error: crashed\n', 'crashed'),
            ('', '', 'Q# lints failed'),
        ):
            failed = subprocess.CompletedProcess((), 1, stdout=stdout, stderr=stderr)
            with (
                self.subTest(message=message),
                patch.object(qs.shutil, 'which', return_value='/bin/node'),
                patch.object(qs.subprocess, 'run', return_value=failed),
                self.assertRaisesRegex(SystemExit, message),
            ):
                qs.run_language_service_lints()
        with (
            patch.object(qs.shutil, 'which', return_value=None),
            self.assertRaisesRegex(SystemExit, 'Node is required'),
        ):
            qs.run_language_service_lints()


class MainTests(unittest.TestCase):
    """Check the entry point's order of gates with fake QDK modules."""

    def run_main(self, qdk: qs.QdkModules) -> str:
        """Run `main` without arguments and return its output."""
        with (
            patch.object(sys, 'argv', ['check_qsharp.py']),
            patch.object(qs, 'verify_language_package', return_value='1.0.0'),
            patch.object(qs, 'run_language_service_lints'),
            patch.object(qs, 'load_qdk', return_value=qdk),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            qs.main()
        return stdout.getvalue()

    def test_main_runs_every_gate(self) -> None:
        """Base QIR, the `@Test()` suite, guards and coverage run, all under Base."""
        summary = qs.CoverageSummary(1, 1, 1, 1, (), ())
        profiles: list[tuple[str, object]] = []
        context = FakeContext(namespace(), fail_every_guard)
        runs: list[object] = []

        def factory(**kwargs: object) -> FakeContext:
            profiles.append((Path(str(kwargs['project_root'])).name, kwargs['target_profile']))
            return context

        def run_tests(**kwargs: object) -> None:
            runs.append(kwargs['context'])
            print('3 passed')

        with (
            patch.object(qs, 'run_coverage_gate', return_value={'src/a.qs': summary}) as gate,
            patch.object(qs, 'write_and_enforce_coverage') as enforce,
        ):
            output = self.run_main(modules(factory, run_tests))
        self.assertIn('3 passed', output)
        self.assertEqual(runs, [context])
        self.assertEqual({profile for _, profile in profiles}, {'base'})
        self.assertEqual(profiles[0], ('quantum', 'base'))
        self.assertEqual(context.compiled, list(qs.QIR_WIDTHS))
        gate.assert_called_once()
        enforce.assert_called_once_with({'src/a.qs': summary})

    def test_main_stops_on_lint_errors(self) -> None:
        """Lint errors stop the check before QDK loads."""
        with (
            patch.object(qs, 'lint_qsharp_sources', return_value=['a.qs:1: deprecatedSet']),
            patch.object(qs, 'load_qdk') as load,
            patch.object(sys, 'argv', ['check_qsharp.py']),
            self.assertRaisesRegex(SystemExit, 'deprecatedSet'),
        ):
            qs.main()
        load.assert_not_called()

    def test_main_rejects_compiler_warnings(self) -> None:
        """Any warning while the project compiles fails the check."""

        def warning_factory(**_: object) -> FakeContext:
            warnings.warn('unused variable', UserWarning, stacklevel=1)
            return FakeContext(namespace(), fail_every_guard)

        with self.assertRaisesRegex(SystemExit, 'warning\\(s\\): unused variable'):
            self.run_main(modules(warning_factory))

    def test_main_requires_enough_tests(self) -> None:
        """Fewer `@Test()` callables than the minimum fail the check."""
        with self.assertRaisesRegex(SystemExit, 'at least 3 @Test'):
            self.run_main(modules(constant(FakeContext(namespace(tests=2), fail_every_guard))))

    def test_load_qdk_disables_telemetry_first(self) -> None:
        """Telemetry is off before any QDK import, and the needed interfaces are returned."""
        seen: list[tuple[str, str | None]] = []
        fakes = {
            'qdk': SimpleNamespace(Context=FakeContext),
            'qdk.qsharp': SimpleNamespace(
                TargetProfile=SimpleNamespace(Base='base'),
                QSharpError=QSharpError,
            ),
            'qdk.test_utils': SimpleNamespace(run_tests=guard),
        }

        def import_module(name: str) -> SimpleNamespace:
            seen.append((name, os.environ.get('QDK_PYTHON_TELEMETRY')))
            return fakes[name]

        with (
            patch.dict(os.environ, {'QDK_PYTHON_TELEMETRY': 'on'}),
            patch.object(qs.importlib, 'import_module', import_module),
        ):
            loaded = qs.load_qdk()
        self.assertEqual([value for _, value in seen], ['none'] * 3)
        self.assertEqual(loaded.target_base, 'base')
        self.assertIs(loaded.qsharp_error, QSharpError)

    def test_cli_rejects_arguments_before_loading_qdk(self) -> None:
        """Unknown arguments exit before any check runs."""
        result = subprocess.run(  # noqa: S603 - Fixed repository script and argument.
            (sys.executable, str(SCRIPT), '--unknown'),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn('unrecognized arguments', result.stderr)


if __name__ == '__main__':
    unittest.main()
