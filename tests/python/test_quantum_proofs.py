"""Exercise the quantum proof checks without Lean, Cargo or network access."""

import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_proofs
import verify_tex_constants as tex

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / 'scripts' / 'quantum'
SYMBOLIC = REPO / 'quantum' / 'proofs' / 'symbolic'


def run_script(*arguments: str) -> subprocess.CompletedProcess[str]:
    """Run one quantum script as its CLI from a temporary directory."""
    with tempfile.TemporaryDirectory() as temporary:
        return subprocess.run(  # noqa: S603 - Fixed repository scripts and arguments.
            (sys.executable, *arguments),
            cwd=temporary,
            capture_output=True,
            text=True,
            check=False,
        )


class TexConstantTests(unittest.TestCase):
    """Check printed constants, specification scope and label traceability."""

    def test_repository_specification_passes(self) -> None:
        """The committed `.tex` and Lean audit table agree and print the right decimals."""
        result = run_script(str(SCRIPTS / 'verify_tex_constants.py'))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Lean traceability and certificate checks passed', result.stdout)

    def test_printed_requires_the_whole_enclosure_to_round(self) -> None:
        """An enclosure passes only when every real in it rounds to the printed decimal."""
        tex.printed(tex.iv.mpf(['0.61801', '0.61804']), 4, '0.6180', 'u_1')
        with self.assertRaisesRegex(SystemExit, 'u_1 in .* does not print as 0.6181'):
            tex.printed(tex.iv.mpf('0.61803'), 4, '0.6181', 'u_1')
        with self.assertRaisesRegex(SystemExit, 'does not print as 0.6180'):
            tex.printed(tex.iv.mpf(['0.61794', '0.61801']), 4, '0.6180', 'u_1')

    def test_constants_must_still_be_printed(self) -> None:
        """A decimal the script proves fails once the .tex stops printing it as a whole number."""
        text = tex.TEX_PATH.read_text(encoding='utf-8')
        tex.verify_constants(text, tex.min_acceptance(text))
        for edited in (text.replace('0.3656', '0.3657'), text.replace('0.3656', '0.36561')):
            with self.assertRaisesRegex(SystemExit, 'no longer prints 0.3656'):
                tex.verify_constants(edited, tex.min_acceptance(edited))
        with self.assertRaisesRegex(SystemExit, 'no longer prints 0.953'):
            tex.verify_constants(text.replace('0.953', '0.954'), tex.min_acceptance(text))

    def test_binary_entropy_edges(self) -> None:
        """Certain outcomes carry no entropy and a fair coin carries one bit."""
        self.assertEqual(tex.binary_entropy(tex.iv.mpf(0)), 0)
        self.assertEqual(tex.binary_entropy(tex.iv.mpf(1)), 0)
        self.assertIn(1, tex.binary_entropy(tex.iv.mpf('0.5')))

    def test_scope_reports_implementation_vocabulary(self) -> None:
        """Forbidden tokens are reported by line, but the `eq:pool-cap` label is allowed."""
        tex.verify_specification_scope(
            'A pure theorem.\n'
            '\\label{eq:pool-cap} see \\eqref{eq:pool-cap} and \\ref{eq:pool-cap}\n'
        )
        with self.assertRaises(SystemExit) as raised:
            tex.verify_specification_scope('Fine.\nThe Discord sidecar.\n')
        message = str(raised.exception)
        self.assertIn("'Discord' on line 2", message)
        self.assertIn("'sidecar' on line 2", message)

    def test_scope_tokens_need_a_word_start(self) -> None:
        """A token inside a longer word is allowed; the token or its plural is not."""
        tex.verify_specification_scope('A remote demotion.\n')
        for line in ('Two emotes.\n', 'An emote.\n'):
            with self.subTest(line=line), self.assertRaisesRegex(SystemExit, "'emote' on line 1"):
                tex.verify_specification_scope(line)

    def test_traceability_requires_matching_labels(self) -> None:
        """Every `.tex` label needs an audit entry, and every audit entry needs a `.tex` label."""
        text = '\\label{thm:budget} \\label{def:pool} \\label{eq:ignored}'
        audit = '("thm:budget", [`a]),\n("def:pool", [`b])'
        tex.verify_traceability(text, audit)
        with self.assertRaisesRegex(SystemExit, r"without audited Lean theorems: \['def:pool'\]"):
            tex.verify_traceability(text, '("thm:budget", [`a])')
        with self.assertRaisesRegex(SystemExit, r"missing from the .tex: \['rem:extra'\]"):
            tex.verify_traceability(text, audit + ',\n("rem:extra", [`c])')
        with self.assertRaisesRegex(SystemExit, 'no environment labels'):
            tex.verify_traceability('\\label{eq:only}', audit)

    def test_main_reads_the_configured_files(self) -> None:
        """`main` checks the files named by its path constants."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, audit = root / 'spec.tex', root / 'AuditAxioms.lean'
            source.write_text('\\label{prop:one}\n', encoding='utf-8')
            audit.write_text('("prop:two", [`x])\n', encoding='utf-8')
            with (
                patch.object(tex, 'TEX_PATH', source),
                patch.object(tex, 'AUDIT_PATH', audit),
                self.assertRaisesRegex(SystemExit, r'prop:certificate.* not found'),
            ):
                tex.main()


TABLE = r"""
\caption{Metrics.\label{tab:domain-profile}}
  \((n_b, n_o, L)\) & a & b & c & d & e & f \\
  \midrule
  \((1, 1, 3)\) & \(0.2010\) & \(1.0000\) & \(1.0000\) & \(1.00\) & \(0.1968\)
    & \(1.22 \times 10^{-1}\) \\
  \bottomrule
"""
PROPOSITION = r"""
\label{prop:certificate}
  Quantity & Value & At \\
  \( \min p_A \) & \( \approx 0.259488 \) & \( (9, 7, 5) \) \\
  \( \max \Prob(\tau > 256) \) & \( \le 3.98 \times 10^{-34} \) & \( (9, 7, 5) \) \\
\end{proposition}
"""
CERTIFICATE = """
check(&|m| m.acceptance, Config::new(9, 7, 5), &|m| m.acceptance.within(0.259_488, 1e-6));
let bound = 3.98e-34;
fn table_one_rows_match_the_simulation() {
  let rows = [
    (1, 1, 3, 0.2010, 1.0000, 1.0000, 1.00, 0.1968, 1.22e-1),
  ];
}
"""


class CertificateTraceabilityTests(unittest.TestCase):
    """Check that the certificate asserts what the `.tex` prints."""

    def test_numbers_parse_in_both_notations(self) -> None:
        """LaTeX scientific notation and Rust literals with separators read as exact decimals."""
        self.assertEqual(
            tex.tex_numbers(r'0.2010 and 1.22 \times 10^{-1}'),
            [
                tex.Decimal('0.2010'),
                tex.Decimal('0.122'),
            ],
        )
        self.assertEqual(
            tex.rust_numbers('within(0.259_488, 1e-6) x1.5 3.98e-34'),
            [
                tex.Decimal('0.259488'),
                tex.Decimal('3.98e-34'),
            ],
        )

    def test_matching_certificate_passes(self) -> None:
        """Equal Table 1 rows and covered Proposition 5.2 values pass, and `min p_A` is read."""
        text = TABLE + PROPOSITION
        tex.verify_certificate(text, CERTIFICATE)
        self.assertEqual(tex.min_acceptance(text), '0.259488')
        self.assertEqual(tex.tex_table_one(text), tex.certificate_table_one(CERTIFICATE))

    def test_differences_are_reported(self) -> None:
        """A changed row, an unchecked value or an unchecked configuration fails."""
        text = TABLE + PROPOSITION
        for source, message in (
            (CERTIFICATE.replace('0.1968', '0.1969'), 'certificate Table 1 rows'),
            (CERTIFICATE.replace('3.98e-34', '3.99e-34'), r'Proposition 5.2 \[Decimal'),
            (CERTIFICATE.replace('Config::new(9, 7, 5)', 'Config::new(9, 7, 4)'), r'\(9, 7, 5\)'),
            (CERTIFICATE.replace('let bound = 3.98e-34;', '// 3.98e-34'), r'Proposition 5.2'),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                tex.verify_certificate(text, source)

    def test_malformed_sources_are_rejected(self) -> None:
        """Missing sections, malformed rows, empty tables and an absent `min p_A` fail."""
        cases = (
            (lambda: tex.tex_table_one('no table'), 'not found'),
            (lambda: tex.tex_table_one(TABLE.replace(r' & \(1.00\)', '')), 'malformed Table 1'),
            (
                lambda: tex.tex_table_one(r'\label{tab:domain-profile} \midrule \bottomrule'),
                'Table 1 has no rows',
            ),
            (lambda: tex.min_acceptance(PROPOSITION.replace('min p_A', 'min q_A')), 'single min'),
            (lambda: tex.section(r'\label{prop:certificate}', r'\label', 'never'), 'not found'),
            (
                lambda: tex.verify_certificate(
                    TABLE + r'\label{prop:certificate} \end{proposition}', CERTIFICATE
                ),
                'Proposition 5.2 has no rows',
            ),
        )
        for call, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(SystemExit, message):
                call()


class CheckProofsTests(unittest.TestCase):
    """Cover stage selection, command execution and the Lean text scan."""

    def test_lean_sources_exist(self) -> None:
        """The root module and every `BotgeLean` module are scanned, and they are clean."""
        sources = check_proofs.lean_sources()
        self.assertEqual(sources[0].name, 'BotgeLean.lean')
        self.assertGreater(len(sources), 1)
        self.assertTrue(all(path.is_file() for path in sources))
        self.assertEqual(check_proofs.scan_lean(sources), [])

    def test_scan_lean_reports_each_violation(self) -> None:
        """CRLF, whitespace, width and every forbidden construct are reported with locations."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            clean = root / 'Clean.lean'
            clean.write_text('theorem ok : True := trivial\n', encoding='utf-8')
            dirty = root / 'Dirty.lean'
            dirty.write_bytes(
                b'theorem a : True := by sorry \r\n'
                b'\tadmit\n'
                b'axiom bad : False\n'
                b'public noncomputable axiom bad2 : False\n'
                b'example : 1 = 1 := by native_decide\n'
                b'#print axioms a\n'
                b'set_option linter.all false\n' + b'-' * 101 + b'\n'
            )
            errors = check_proofs.scan_lean([clean, dirty], root)
        self.assertEqual(
            errors,
            [
                'Dirty.lean: CRLF line endings',
                'Dirty.lean:1: trailing whitespace',
                'Dirty.lean:1: `sorry`',
                'Dirty.lean:2: tab character',
                'Dirty.lean:2: `admit`',
                'Dirty.lean:3: axiom declaration',
                'Dirty.lean:4: axiom declaration',
                'Dirty.lean:5: `native_decide` (trusts the compiler)',
                'Dirty.lean:6: `#print axioms` (use `lake exe audit_axioms`)',
                'Dirty.lean:7: `set_option` (configure options in lakefile.toml)',
                'Dirty.lean:8: line longer than 100 columns',
            ],
        )

    def test_scan_lean_ignores_forbidden_words_in_comments(self) -> None:
        """`sorry` in line, block, nested and doc comments passes; in code and strings it fails."""
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'Comments.lean'
            source.write_text(
                '-- no sorry here\n'
                '/-- Doc: avoid `native_decide`. -/\n'
                '/- outer /- inner sorry -/\n'
                'still admit in a comment -/\n'
                'def s : String := "-- not a comment"\n'
                'theorem t : True := by sorry\n',
                encoding='utf-8',
            )
            self.assertEqual(check_proofs.scan_lean([source], root), ['Comments.lean:6: `sorry`'])
        self.assertEqual(check_proofs.blank_lean_comments('a -- b\nc'), 'a     \nc')

    def test_tool_reports_missing_executable(self) -> None:
        """A missing tool stops with its installation hint."""
        with patch.object(check_proofs.shutil, 'which', return_value='/bin/lake'):
            self.assertEqual(check_proofs.tool('lake', 'hint'), '/bin/lake')
        with (
            patch.object(check_proofs.shutil, 'which', return_value=None),
            self.assertRaisesRegex(SystemExit, 'Missing `lake`; install elan'),
        ):
            check_proofs.tool('lake', 'install elan')

    def test_run_echoes_and_stops_on_failure(self) -> None:
        """Commands are echoed, and a non-zero status stops the run."""
        with tempfile.TemporaryDirectory() as temporary:
            with contextlib.redirect_stdout(io.StringIO()) as stdout:
                check_proofs.run([sys.executable, '-c', 'pass'], Path(temporary))
            self.assertIn(f'$ {sys.executable} -c pass', stdout.getvalue())
            with (
                contextlib.redirect_stdout(io.StringIO()),
                self.assertRaisesRegex(SystemExit, 'failed with status 3'),
            ):
                check_proofs.run([sys.executable, '-c', 'raise SystemExit(3)'], Path(temporary))

    def test_check_lean_scans_before_building(self) -> None:
        """Scan errors stop the stage before Lake runs; a clean scan runs build, lint and audit."""
        with (
            patch.object(check_proofs, 'scan_lean', return_value=['A.lean:1: `sorry`']),
            patch.object(check_proofs, 'run') as run,
            self.assertRaisesRegex(SystemExit, 'A.lean:1: `sorry`'),
        ):
            check_proofs.check_lean()
        run.assert_not_called()
        with (
            patch.object(check_proofs, 'scan_lean', return_value=[]),
            patch.object(check_proofs, 'tool', return_value='lake'),
            patch.object(check_proofs, 'run') as run,
        ):
            check_proofs.check_lean()
        self.assertEqual(
            [call.args for call in run.call_args_list],
            [
                (['lake', 'build'], check_proofs.LEAN_ROOT),
                (['lake', 'lint'], check_proofs.LEAN_ROOT),
                (['lake', 'exe', 'audit_axioms'], check_proofs.LEAN_ROOT),
            ],
        )

    def test_script_and_cargo_stages_run_fixed_commands(self) -> None:
        """The symbolic, tex and rust stages run their scripts and Cargo from the repository."""
        root = check_proofs.REPO_ROOT
        with (
            patch.object(check_proofs, 'tool', return_value='cargo'),
            patch.object(check_proofs, 'run') as run,
        ):
            check_proofs.check_symbolic()
            check_proofs.check_tex()
            check_proofs.check_rust()
        commands = [call.args for call in run.call_args_list]
        self.assertEqual(
            commands[:2],
            [
                ([sys.executable, str(SYMBOLIC / 'verify_symbolic.py')], root),
                ([sys.executable, str(SCRIPTS / 'verify_tex_constants.py')], root),
            ],
        )
        self.assertEqual(
            commands[2],
            (
                [
                    'cargo',
                    'fmt',
                    '--check',
                    '-p',
                    'botge-quantum',
                    '-p',
                    'botge-quantum-certificate',
                ],
                root,
            ),
        )
        self.assertIn('botge-quantum', commands[3][0])
        self.assertIn('botge-quantum-certificate', commands[4][0])
        self.assertTrue(all(cwd == root for _, cwd in commands))

    def test_main_runs_selected_stages_in_order(self) -> None:
        """`--only` keeps the canonical order; no selection runs every stage."""
        calls: list[str] = []
        stages = {stage: (lambda stage=stage: calls.append(stage)) for stage in check_proofs.STAGES}
        with (
            patch.dict(check_proofs.CHECKS, stages),
            patch.object(sys, 'argv', ['check_proofs.py', '--only', 'tex', '--only', 'lean']),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
        ):
            check_proofs.main()
        self.assertEqual(calls, ['lean', 'tex'])
        self.assertIn('Proof checks passed: lean, tex.', stdout.getvalue())
        calls.clear()
        with (
            patch.dict(check_proofs.CHECKS, stages),
            patch.object(sys, 'argv', ['check_proofs.py']),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            check_proofs.main()
        self.assertEqual(calls, list(check_proofs.STAGES))

    def test_cli_rejects_unknown_stage_and_runs_tex(self) -> None:
        """Argument errors exit before any check; the tex stage runs end to end."""
        script = str(SCRIPTS / 'check_proofs.py')
        rejected = run_script(script, '--only', 'coq')
        self.assertEqual(rejected.returncode, 2)
        self.assertIn('invalid choice', rejected.stderr)
        passed = run_script(script, '--only', 'tex')
        self.assertEqual(passed.returncode, 0, passed.stdout + passed.stderr)
        self.assertIn('Proof checks passed: tex.', passed.stdout)

    def test_scan_lean_cli_checks_selected_files_only(self) -> None:
        """`--scan-lean` scans the given files without invoking Lake."""
        lean_file = REPO / 'quantum' / 'proofs' / 'lean' / 'BotgeLean.lean'
        with (
            patch.object(sys, 'argv', ['check_proofs.py', '--scan-lean', str(lean_file)]),
            patch.object(check_proofs, 'run') as run,
        ):
            check_proofs.main()
        run.assert_not_called()

        with tempfile.TemporaryDirectory() as temporary:
            dirty = Path(temporary) / 'Dirty.lean'
            dirty.write_text('theorem bad : True := by sorry\n', encoding='utf-8')
            with (
                patch.object(check_proofs, 'REPO_ROOT', Path(temporary)),
                patch.object(sys, 'argv', ['check_proofs.py', '--scan-lean', str(dirty)]),
                self.assertRaisesRegex(SystemExit, 'Dirty.lean:1: `sorry`'),
            ):
                check_proofs.main()


if __name__ == '__main__':
    unittest.main()
