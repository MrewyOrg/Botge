"""Exercise the chemistry proof scripts without Lean, Cargo, or sidecar HTTP calls."""

import runpy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_chemistry_proofs as chem_check
import verify_chemistry_tex as chem_tex

REPO = Path(__file__).resolve().parents[2]
CHEM_SCRIPTS = REPO / 'scripts' / 'chemistry'


class ChemistryProofScriptTests(unittest.TestCase):
    """Cover `verify_chemistry_tex.py` and `check_chemistry_proofs.py` branches."""

    def test_verify_tex_constants_passes_repo_spec(self) -> None:
        """Committed `botge-chemistry.tex` passes scope, Lean label, and matrix checks."""
        chem_tex.main()
        runpy.run_path(str(CHEM_SCRIPTS / 'verify_chemistry_tex.py'), run_name='__main__')

    def test_verify_tex_constants_rejects_broken_inputs(self) -> None:
        """Forbidden tokens, missing labels, and mismatched counts exit cleanly."""
        with self.assertRaises(SystemExit):
            chem_tex.require(condition=False, message='bad')
        with self.assertRaisesRegex(SystemExit, 'Missing tab:reactions'):
            chem_tex.parse_table_rows('no table here')
        with self.assertRaisesRegex(SystemExit, 'Missing tab:substrates'):
            chem_tex.check_substrate_table('no substrate table')

        tex = chem_tex.TEX_PATH.read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory() as tmp:
            bad_tex = Path(tmp) / 'bad.tex'
            bad_tex.write_text('RDKit leaked here.\n', encoding='utf-8')
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Forbidden implementation token'),
            ):
                chem_tex.main()

            bad_tex.write_text(tex + '\n\\label{thm:unmapped}\n', encoding='utf-8')
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Unmapped .tex labels'),
            ):
                chem_tex.main()

            bad_tex.write_text(
                tex.replace('Total reactive & & 166', 'Total reactive & & 999'),
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Total reactive row mismatch'),
            ):
                chem_tex.main()

            bad_tex.write_text(tex.replace('8{,}743', '12{,}345'), encoding='utf-8')
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Printed max PNG byte bound'),
            ):
                chem_tex.main()

            bad_tex.write_text(
                tex.replace(r'\smiles{C=CC(=C)C}', r'\smiles{CC(=C)C=C}'),
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'does not match canonical'),
            ):
                chem_tex.main()

            bad_tex.write_text(tex.replace('Diels--Alder', 'DielsXAlder'), encoding='utf-8')
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Missing or duplicate Table 1 row'),
            ):
                chem_tex.main()

    def test_rust_atlas_sync_missing_and_mismatched(self) -> None:
        """Rust/Python atlas cross-check handles missing file and catches drift."""
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / 'missing.rs'
            with patch.object(chem_tex, 'RUST_ATLAS_PATH', missing):
                chem_tex.check_rust_python_atlas_sync()

            bad_rust = Path(tmp) / 'atlas.rs'
            bad_rust.write_text(
                'SubstrateInfo { name: "wrong", group: "wrong" }',
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'RUST_ATLAS_PATH', bad_rust),
                self.assertRaisesRegex(SystemExit, 'Rust/Python atlas mismatch'),
            ):
                chem_tex.check_rust_python_atlas_sync()

            real_rust = chem_tex.RUST_ATLAS_PATH.read_text(encoding='utf-8')
            bad_mask = bad_rust
            bad_mask.write_text(
                real_rust.replace('0x0000_00f0', '0x0000_0000', 1),
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'RUST_ATLAS_PATH', bad_mask),
                self.assertRaisesRegex(SystemExit, 'compatibility mask mismatch'),
            ):
                chem_tex.check_rust_python_atlas_sync()

            missing_mask = bad_rust
            missing_mask.write_text(
                real_rust.replace('const COMPAT_HEAT:', 'const OTHER_HEAT:', 1),
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'RUST_ATLAS_PATH', missing_mask),
                self.assertRaisesRegex(SystemExit, 'Missing Rust compatibility mask'),
            ):
                chem_tex.check_rust_python_atlas_sync()

    def test_scan_lean_comments_and_hygiene_violations(self) -> None:
        """Comment blanker preserves strings/newlines and scanner reports all violations."""
        raw = 'def x := "-- sorry" /- nested /- sorry -/ -/\n-- sorry\naxiom bad : Prop\n'
        blanked = chem_check.blank_lean_comments(raw)
        self.assertIn('"-- sorry"', blanked)
        self.assertIn('axiom bad', blanked)
        self.assertEqual(raw.count('\n'), blanked.count('\n'))

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            clean = root / 'Clean.lean'
            clean.write_text('def ok : Nat := 1\n', encoding='utf-8')
            self.assertEqual(chem_check.scan_lean([clean], root=root), [])

            dirty = root / 'Dirty.lean'
            dirty.write_bytes(b'def a := 1  \r\n\tsorry\n' + b'x' * 101 + b'\n')
            errors = chem_check.scan_lean([dirty], root=root)
            joined = '\n'.join(errors)
            self.assertIn('CRLF line endings', joined)
            self.assertIn('trailing whitespace', joined)
            self.assertIn('tab character', joined)
            self.assertIn('line longer than', joined)
            self.assertIn('`sorry`', joined)

    def test_check_proofs_cli_and_stages(self) -> None:
        """Stage runners, tool lookup, and CLI `--scan-lean` / `--only` work cleanly."""
        with (
            patch.object(chem_check.shutil, 'which', return_value=None),
            self.assertRaises(SystemExit),
        ):
            chem_check.tool('missing-bin', 'install it')

        ok = subprocess.CompletedProcess[str](['cmd'], 0)
        fail = subprocess.CompletedProcess[str](['cmd'], 2)
        with (
            patch.object(chem_check.shutil, 'which', return_value='/usr/bin/fake'),
            patch.object(chem_check.subprocess, 'run', return_value=ok),
        ):
            chem_check.check_lean()
            chem_check.check_symbolic()
            chem_check.check_certificate()
            chem_check.check_rust()
            chem_check.check_tex()

        with (
            patch.object(chem_check.subprocess, 'run', return_value=fail),
            self.assertRaisesRegex(SystemExit, 'failed with status 2'),
        ):
            chem_check.run(['fake'], REPO)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lean_file = root / 'Good.lean'
            lean_file.write_text('def ok : Nat := 0\n', encoding='utf-8')
            with (
                patch.object(chem_check, 'REPO_ROOT', root),
                patch.object(
                    sys,
                    'argv',
                    ['check_chemistry_proofs.py', '--scan-lean', str(lean_file)],
                ),
            ):
                chem_check.main()

            bad_file = root / 'Bad.lean'
            bad_file.write_text('theorem x : False := by admit\n', encoding='utf-8')
            with (
                patch.object(chem_check, 'REPO_ROOT', root),
                patch.object(
                    sys,
                    'argv',
                    ['check_chemistry_proofs.py', '--scan-lean', str(bad_file)],
                ),
                self.assertRaises(SystemExit),
            ):
                chem_check.main()

        with (
            patch.object(chem_check, 'scan_lean', return_value=['bad lean']),
            self.assertRaisesRegex(SystemExit, 'bad lean'),
        ):
            chem_check.check_lean()

        with (
            patch.dict(chem_check.CHECKS, {'symbolic': lambda: None}),
            patch.object(sys, 'argv', ['check_chemistry_proofs.py', '--only', 'symbolic']),
        ):
            chem_check.main()


if __name__ == '__main__':
    unittest.main()
