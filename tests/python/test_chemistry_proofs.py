"""Exercise the chemistry proof scripts without Lean, Cargo, or sidecar HTTP calls."""

import re
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import check_chemistry_proofs as chem_check
import verify_chemistry_tex as chem_tex

REPO = Path(__file__).resolve().parents[2]
CHEM_SCRIPTS = REPO / 'scripts' / 'chemistry'
REAL_RUST_ATLAS = REPO / 'crates' / 'botge-chemistry' / 'src' / 'atlas.rs'

_CANONICAL_SMILES: dict[str, str] = {
    'CC(=C)C=C': 'C=CC(=C)C',
    'C1=CC=CCC1': 'C1=CCCC=C1',
    'O=C1OC(=O)C=C1': 'O=C1C=CC(=O)O1',
    'COC(=O)C=C': 'C=CC(=O)OC',
    'CC(=O)C=C': 'C=CC(C)=O',
    'CC(=O)C': 'CC(C)=O',
    'CC(=O)CC(=O)C': 'CC(=O)CC(C)=O',
}

_FORMULAS_BY_CANONICAL: dict[str, str] = {
    'C=CC=C': 'C4H6',
    'C=CC(=C)C': 'C5H8',
    'C1=CCCC=C1': 'C6H8',
    'C1=CCC=C1': 'C5H6',
    'O=C1C=CC(=O)O1': 'C4H2O3',
    'C=CC(=O)OC': 'C4H6O2',
    'C=CC#N': 'C3H3N',
    'C=CC(C)=O': 'C4H6O',
    'CC(=O)O': 'C2H4O2',
    'CCC(=O)O': 'C3H6O2',
    'O=C(O)c1ccccc1': 'C7H6O2',
    'CO': 'CH4O',
    'CCO': 'C2H6O',
    'OCc1ccccc1': 'C7H8O',
    'CN': 'CH5N',
    'CCN': 'C2H7N',
    'Nc1ccccc1': 'C6H7N',
    'C1CCNC1': 'C4H9N',
    'CC=O': 'C2H4O',
    'CCC=O': 'C3H6O',
    'O=Cc1ccccc1': 'C7H6O',
    'CC(C)=O': 'C3H6O',
    'CC(=O)Cl': 'C2H3ClO',
    'O=C(Cl)c1ccccc1': 'C7H5ClO',
    'CCCCBr': 'C4H9Br',
    'BrCc1ccccc1': 'C7H7Br',
    'Brc1ccccc1': 'C6H5Br',
    'COc1ccc(Br)cc1': 'C7H7BrO',
    'OB(O)c1ccccc1': 'C6H7BO2',
    'Cc1ccc(B(O)O)cc1': 'C7H9BO2',
    'CC(=O)CC(C)=O': 'C5H8O2',
    'COC(=O)CC(=O)OC': 'C5H8O4',
}

_RUST_MASK_NAMES: dict[str, str] = {
    'heat': 'COMPAT_HEAT',
    'acid': 'COMPAT_ACID',
    'base': 'COMPAT_BASE',
    'palladium': 'COMPAT_PALLADIUM',
}


def _load_real_rust_masks() -> dict[str, list[int]]:
    """Read the 32-bit compatibility masks from the Rust atlas source."""
    text = REAL_RUST_ATLAS.read_text(encoding='utf-8')
    masks: dict[str, list[int]] = {}
    for cond, const_name in _RUST_MASK_NAMES.items():
        match = re.search(
            rf'const\s+{const_name}:\s*\[u32;[^\]]+\]\s*=\s*\[([^\]]+)\]',
            text,
        )
        if match is None:
            msg = f'Missing {const_name} in {REAL_RUST_ATLAS}'
            raise AssertionError(msg)
        masks[cond] = [
            int(token.replace('_', ''), 16)
            for token in re.findall(r'0x[0-9a-fA-F_]+', match.group(1))
        ]
    return masks


def _fake_rdkit_modules() -> dict[str, types.ModuleType]:
    """Build lightweight stubs for RDKit-backed modules so CI without `rdkit` passes."""
    counts = {
        'diels_alder': 32,
        'fischer_esterification': 18,
        'imine_condensation': 36,
        'amide_coupling': 16,
        'williamson_sn2': 12,
        'aldol_condensation': 32,
        'michael_addition': 12,
        'suzuki_miyaura': 8,
    }

    def _verify_matrix() -> dict[str, object]:
        return {
            'explicit_counts': dict(counts),
            'auto_counts': dict(counts),
            'non_reactive_explicit': 3930,
            'non_reactive_auto': 858,
            'max_png_bytes': 8743,
        }

    def _mol_from_smiles(smiles: str) -> str:
        return smiles

    def _mol_to_smiles(mol: str, **_kwargs: bool) -> str:
        return _CANONICAL_SMILES.get(mol, mol)

    def _calc_mol_formula(mol: str) -> str:
        return _FORMULAS_BY_CANONICAL[_CANONICAL_SMILES.get(mol, mol)]

    verify_matrix_mod = types.ModuleType('verify_matrix')
    verify_matrix_mod.__dict__['verify_matrix'] = _verify_matrix

    rdkit_mod = types.ModuleType('rdkit')
    chem_mod = types.ModuleType('rdkit.Chem')
    desc_mod = types.ModuleType('rdkit.Chem.rdMolDescriptors')
    chem_mod.__dict__['MolFromSmiles'] = _mol_from_smiles
    chem_mod.__dict__['MolToSmiles'] = _mol_to_smiles
    desc_mod.__dict__['CalcMolFormula'] = _calc_mol_formula
    chem_mod.__dict__['rdMolDescriptors'] = desc_mod
    rdkit_mod.__dict__['Chem'] = chem_mod

    masks = _load_real_rust_masks()

    class _ReactedOutcome:
        pass

    class _PoolTarget:
        def __init__(
            self,
            base: object,
            overlay: object,
            *,
            include_diagram: bool = False,
        ) -> None:
            self.base = base
            self.overlay = overlay
            self.include_diagram = include_diagram

    class _ChemistryEngine:
        def react(
            self,
            a: int,
            b: int,
            cond: str,
            _target: _PoolTarget,
        ) -> _ReactedOutcome | None:
            return _ReactedOutcome() if (masks[cond][a] >> b) & 1 else None

    engine_mod = types.ModuleType('engine')
    engine_mod.__dict__['ReactedOutcome'] = _ReactedOutcome
    engine_mod.__dict__['PoolTarget'] = _PoolTarget
    engine_mod.__dict__['ChemistryEngine'] = _ChemistryEngine

    return {
        'verify_matrix': verify_matrix_mod,
        'rdkit': rdkit_mod,
        'rdkit.Chem': chem_mod,
        'rdkit.Chem.rdMolDescriptors': desc_mod,
        'engine': engine_mod,
    }


class ChemistryProofScriptTests(unittest.TestCase):
    """Cover `verify_chemistry_tex.py` and `check_chemistry_proofs.py` branches."""

    def test_verify_tex_constants_passes_repo_spec(self) -> None:
        """Committed `botge-chemistry.tex` passes scope, Lean label, and matrix checks."""
        with patch.dict(sys.modules, _fake_rdkit_modules()):
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
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, _fake_rdkit_modules()):
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

            bad_tex.write_text(
                tex.replace('valid PNG of at most', 'valid PNG of'),
                encoding='utf-8',
            )
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'Printed max PNG byte bound'),
            ):
                chem_tex.main()

            bad_tex.write_text(tex.replace('10{,}000', '1{,}000'), encoding='utf-8')
            with (
                patch.object(chem_tex, 'TEX_PATH', bad_tex),
                self.assertRaisesRegex(SystemExit, 'exceeds printed bound'),
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
        with tempfile.TemporaryDirectory() as tmp, patch.dict(sys.modules, _fake_rdkit_modules()):
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
