"""Check chemistry/docs/botge-chemistry.tex scope, Table 1 constants, and Lean traceability."""

import importlib
import re
import sys
from pathlib import Path
from typing import Any, cast

REPO_ROOT = Path(__file__).resolve().parents[2]
TEX_PATH = REPO_ROOT / 'chemistry' / 'docs' / 'botge-chemistry.tex'
AUDIT_PATH = REPO_ROOT / 'chemistry' / 'proofs' / 'lean' / 'BotgeChemLean' / 'AuditAxioms.lean'
CERT_DIR = REPO_ROOT / 'chemistry' / 'proofs' / 'certificate'
RUST_ATLAS_PATH = REPO_ROOT / 'crates' / 'botge-chemistry' / 'src' / 'atlas.rs'

ENVIRONMENT_LABEL = re.compile(r'\\label\{((?:thm|prop|lem|cor|rem|def):[A-Za-z0-9-]+)\}')
AUDIT_LABEL = re.compile(r'\("((?:thm|prop|lem|cor|rem|def):[A-Za-z0-9-]+)",\s*\[')
FORBIDDEN_TOKENS = (
    'BotgeMuted',
    'enumitem',
    'RDKit',
    'FastAPI',
    'Discord',
    'Rust',
    'Python',
    'HTTP',
    'emote',
    'sidecar',
    '7TV',
    'semaphore',
    'timeout',
)
TABLE_ROW = re.compile(
    r'^(?P<label>[^&\n]+?)\s*&\s*(?P<cond>[^&\n]*?)\s*&\s*(?P<explicit>[\d{,}]+)\s*&\s*(?P<auto>[\d{,}]+)\s*\\\\'
)
SUBSTRATE_ROW = re.compile(
    r'^(?P<index>\d+)\s*&\s*(?P<name>[^&\n]+?)\s*&\s*(?P<group>[^&\n]+?)\s*&\s*'
    r'\\chem\{(?P<formula>[^}]+)\}\s*&\s*\\smiles\{(?P<smiles>[^}]+)\}\s*\\\\$'
)
MAX_PNG_BOUND = re.compile(r'valid PNG of at most \\\(\s*([0-9{,}]+)\s*\\\)\s*bytes')
MAX_PNG_LIMIT = 131_072
TEX_TABLE_MAPPING = (
    ('Diels--Alder', 'diels_alder'),
    ('Fischer esterification', 'fischer_esterification'),
    ('Imine condensation', 'imine_condensation'),
    ('Acylation / amide coupling', 'amide_coupling'),
    ('Williamson', 'williamson_sn2'),
    ('Aldol condensation', 'aldol_condensation'),
    ('Michael conjugate addition', 'michael_addition'),
    ('Suzuki--Miyaura cross-coupling', 'suzuki_miyaura'),
)


def require(condition: object, message: str) -> None:
    """Exit with `message` unless `condition` is truthy."""
    if not bool(condition):
        raise SystemExit(message)


def parse_table_rows(tex: str) -> dict[str, tuple[int, int]]:
    """Extract `(explicit_pairs, auto_pairs)` rows from Table 1 of the specification."""
    start = tex.find(r'\label{tab:reactions}')
    end = tex.find(r'\end{tabular}', start)
    require(start >= 0 and end > start, 'Missing tab:reactions tabular body')
    body = tex[start:end]
    rows: dict[str, tuple[int, int]] = {}
    for raw_line in body.splitlines():
        match = TABLE_ROW.match(raw_line.strip())
        if match:
            rows[match.group('label').strip()] = (
                int(match.group('explicit').replace('{,}', '')),
                int(match.group('auto').replace('{,}', '')),
            )
    return rows


def _parse_rust_mask_table(rust_text: str, const_name: str) -> list[int]:
    """Parse a `const COMPAT_*: [u32; ATLAS_SIZE as usize] = [...];` array from Rust."""
    match = re.search(rf'const {const_name}:\s*\[u32;[^\]]+\]\s*=\s*\[([^\]]+)\];', rust_text)
    body = match.group(1) if match is not None else ''
    require(bool(body), f'Missing Rust compatibility mask table {const_name}')
    return [int(tok, 16) for tok in re.findall(r'0x[0-9a-fA-F_]+', body)]


def check_substrate_table(tex: str) -> None:
    """Verify every substrate index, class, Hill formula, and canonical SMILES in Table 1."""
    start = tex.find(r'\label{tab:substrates}')
    end = tex.find(r'\end{tabular}', start)
    require(start >= 0 and end > start, 'Missing tab:substrates tabular body')
    if str(REPO_ROOT / 'chemistry') not in sys.path:
        sys.path.insert(0, str(REPO_ROOT / 'chemistry'))
    atlas_mod: Any = importlib.import_module('atlas')
    chem_mod: Any = importlib.import_module('rdkit.Chem')
    mol_desc: Any = importlib.import_module('rdkit.Chem.rdMolDescriptors')

    parsed: list[tuple[int, str, str, str, str]] = []
    for raw_line in tex[start:end].splitlines():
        match = SUBSTRATE_ROW.match(raw_line.strip())
        if match:
            formula = match.group('formula').replace('_', '').replace('{', '').replace('}', '')
            smiles = match.group('smiles').replace(r'\#', '#')
            parsed.append(
                (
                    int(match.group('index')),
                    match.group('name').strip(),
                    match.group('group').strip(),
                    formula,
                    smiles,
                )
            )

    expected: list[tuple[int, str, str, str, str]] = []
    for entry in cast('tuple[Any, ...]', atlas_mod.SUBSTRATES):
        mol = chem_mod.MolFromSmiles(entry.smiles)
        canon_smiles = str(chem_mod.MolToSmiles(mol, isomericSmiles=True, canonical=True))
        hill_formula = str(mol_desc.CalcMolFormula(mol))
        expected.append(
            (int(entry.index), str(entry.name), str(entry.group), hill_formula, canon_smiles)
        )
    require(
        parsed == expected,
        'Table 1 (tab:substrates) does not match canonical RDKit substrates',
    )


def check_rust_python_atlas_sync() -> None:
    """Verify Rust `atlas.rs` and Python `atlas.py` substrates and compatibility masks match."""
    if not RUST_ATLAS_PATH.exists():
        return
    if str(REPO_ROOT / 'chemistry') not in sys.path:
        sys.path.insert(0, str(REPO_ROOT / 'chemistry'))
    atlas_mod: Any = importlib.import_module('atlas')
    engine_mod: Any = importlib.import_module('engine')
    substrates = cast('tuple[Any, ...]', atlas_mod.SUBSTRATES)

    rust_text = RUST_ATLAS_PATH.read_text(encoding='utf-8')
    pattern = r'SubstrateInfo\s*\{\s*name:\s*"([^"]+)",\s*group:\s*"([^"]+)",?\s*\}'
    rust_pairs = re.findall(pattern, rust_text)
    py_pairs = [(str(entry.name), str(entry.group)) for entry in substrates]
    require(
        rust_pairs == py_pairs,
        f'Rust/Python atlas mismatch: {len(rust_pairs)} vs {len(py_pairs)}',
    )

    eng = engine_mod.ChemistryEngine()
    target = engine_mod.PoolTarget(4, 4, include_diagram=False)
    for cond, const_name in (
        ('heat', 'COMPAT_HEAT'),
        ('acid', 'COMPAT_ACID'),
        ('base', 'COMPAT_BASE'),
        ('palladium', 'COMPAT_PALLADIUM'),
    ):
        expected = [0] * int(atlas_mod.ATLAS_SIZE)
        for a in range(int(atlas_mod.ATLAS_SIZE)):
            for b in range(int(atlas_mod.ATLAS_SIZE)):
                if isinstance(eng.react(a, b, cond, target), engine_mod.ReactedOutcome):
                    expected[a] |= 1 << b
        actual = _parse_rust_mask_table(rust_text, const_name)
        require(actual == expected, f'Rust/Python {const_name} compatibility mask mismatch')


def main() -> None:
    """Verify `.tex` scope, Lean label traceability, Table 1 counts, and atlas sync."""
    tex = TEX_PATH.read_text(encoding='utf-8')
    for token in FORBIDDEN_TOKENS:
        require(token not in tex, f'Forbidden implementation token in .tex: {token}')

    tex_labels = set(ENVIRONMENT_LABEL.findall(tex))
    audit_text = AUDIT_PATH.read_text(encoding='utf-8')
    audit_labels = set(AUDIT_LABEL.findall(audit_text))
    missing = sorted(tex_labels - audit_labels)
    require(not missing, f'Unmapped .tex labels in AuditAxioms.lean: {missing}')

    if str(CERT_DIR) not in sys.path:
        sys.path.insert(0, str(CERT_DIR))
    matrix_mod: Any = importlib.import_module('verify_matrix')

    summary = cast('dict[str, Any]', matrix_mod.verify_matrix())
    explicit_counts = summary['explicit_counts']
    auto_counts = summary['auto_counts']
    require(
        isinstance(explicit_counts, dict) and isinstance(auto_counts, dict),
        'Invalid certificate',
    )

    rows = parse_table_rows(tex)
    for prefix, reaction_id in TEX_TABLE_MAPPING:
        matched = [counts for label, counts in rows.items() if label.startswith(prefix)]
        require(len(matched) == 1, f'Missing or duplicate Table 1 row for {prefix}')
        require(
            matched[0] == (explicit_counts[reaction_id], auto_counts[reaction_id]),
            f'Table 1 mismatch for {reaction_id}: {matched[0]}',
        )

    require(
        rows.get('Total reactive') == (166, 166),
        f'Total reactive row mismatch: {rows.get("Total reactive")}',
    )
    require(
        rows.get('Total non-reactive')
        == (summary['non_reactive_explicit'], summary['non_reactive_auto']),
        f'Total non-reactive row mismatch: {rows.get("Total non-reactive")}',
    )
    max_png = summary['max_png_bytes']
    png_match = MAX_PNG_BOUND.search(tex)
    if png_match is None:
        require(condition=False, message='Printed max PNG byte bound missing from .tex')
        return
    printed_bound = int(png_match.group(1).replace('{,}', ''))
    require(
        isinstance(max_png, int) and 0 < max_png <= printed_bound < MAX_PNG_LIMIT,
        f'Observed max PNG {max_png} B exceeds printed bound {printed_bound} B',
    )
    check_substrate_table(tex)
    check_rust_python_atlas_sync()
    print(f'Chemistry .tex verification passed ({len(tex_labels)} labels, max PNG {max_png} B).')


if __name__ == '__main__':
    main()
