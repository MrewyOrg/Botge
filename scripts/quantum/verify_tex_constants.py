"""Check the printed constants of quantum/docs/botge-quantum.tex and its Lean traceability.

* Encloses the decimals the `.tex` prints (Theorem 4.1, Corollary 4.4, Theorem 5.1 and
  Proposition 5.2) in mpmath interval arithmetic and proves each rounds to its printed digits.
* Keeps the `.tex` a pure mathematical specification: no implementation vocabulary.
* Requires every theorem, proposition, lemma, corollary, remark and definition label to appear
  in the `texLabels` table of `quantum/proofs/lean/BotgeLean/AuditAxioms.lean`, which
  `lake exe audit_axioms` checks against the compiled theorems.
* Keeps the certificate (`quantum/proofs/certificate/tests/certificate_414.rs`) proving what the
  `.tex` prints: its Table 1 rows must equal the `.tex` table, and every number and configuration
  of Proposition 5.2 must appear among its checks.
"""

import importlib
import re
from decimal import Decimal
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
TEX_PATH = REPO_ROOT / 'quantum' / 'docs' / 'botge-quantum.tex'
AUDIT_PATH = REPO_ROOT / 'quantum' / 'proofs' / 'lean' / 'BotgeLean' / 'AuditAxioms.lean'

ENVIRONMENT_LABEL = re.compile(r'\\label\{((?:thm|prop|lem|cor|rem|def):[A-Za-z0-9-]+)\}')
AUDIT_LABEL = re.compile(r'\("((?:thm|prop|lem|cor|rem|def):[A-Za-z0-9-]+)",\s*\[')
FORBIDDEN_TOKENS = (
    'BotgeMuted',
    'enumitem',
    'overlay',
    'pool',
    'per-shot',
    r'n_{\min}',
    'QDK',
    'TargetProfile',
    'BotgeQuantum',
    'Discord',
    'Rust',
    'semaphore',
    'timeout',
    'BitLen',
    '7TV',
    'emote',
    'sidecar',
    'HTTP',
    'tab:qsharp-api',
    'rem:batching',
    'prop:e2e',
    'MResetEachZ',
    'EntangleStack',
)
CERTIFICATE_PATH = REPO_ROOT / 'quantum' / 'proofs' / 'certificate' / 'tests' / 'certificate_414.rs'
TEX_NUMBER = re.compile(r'(\d+\.\d+)(?:\s*\\times\s*10\^\{(-?\d+)\})?')
RUST_NUMBER = re.compile(r'(?<![\w.])(\d[\d_]*\.\d[\d_]*(?:e-?\d+)?)')
TEX_CONFIG = re.compile(r'\((\d+), (\d+), (\d+)\)')
RUST_CONFIG = re.compile(r'Config::new\((\d+), (\d+), (\d+)\)')
RUST_TABLE_ROW = re.compile(r'\((\d+), (\d+), (\d+), ([^()]*)\)')
MIN_ACCEPTANCE_QUANTITY = r'\( \min p_A \)'
TABLE_COLUMNS = 6
RULE = re.compile(r'\\(?:top|mid|bottom)rule\b')
RUST_COMMENT = re.compile(r'//[^\n]*|/\*.*?\*/', re.DOTALL)
# Working precision in bits; enclosures stay far narrower than any printed digit.
PRECISION = 200

# mpmath ships without type information; its interval values are dynamically typed here.
type Dynamic = Any

iv: Dynamic = importlib.import_module('mpmath').iv
iv.prec = PRECISION


def require(condition: object, message: str) -> None:
    """Fail the verification run with `message` unless `condition` holds."""
    if not bool(condition):
        raise SystemExit(message)


def appears(text: str, number: str, name: str) -> None:
    """Require the `.tex` to print `number` as a whole decimal, not as part of a longer one."""
    pattern = re.compile(rf'(?<![\d.]){re.escape(number)}(?![\d])')
    require(pattern.search(text), f'{name}: the .tex no longer prints {number}')


def printed(value: Dynamic, digits: int, expected: str, name: str) -> None:
    """Require every real in the enclosure `value` to round to the decimal string `expected`.

    The reals that round to `expected` at `digits` places form the open interval
    `(expected - h, expected + h)` with `h = 10^-digits / 2`; the enclosure must lie inside it.
    """
    half = iv.mpf(f'0.5e-{digits}')
    target = iv.mpf(expected)
    require(
        (target - half).b < value.a and value.b < (target + half).a,
        f'{name} in {value} does not print as {expected}',
    )


type Config = tuple[int, int, int]
type Row = tuple[Config, tuple[Decimal, ...]]


def tex_numbers(text: str) -> list[Decimal]:
    r"""Return each decimal printed in `text`, reading `1.22 \times 10^{-1}` as `0.122`."""
    return [
        Decimal(mantissa) * Decimal(10) ** int(exponent or '0')
        for mantissa, exponent in TEX_NUMBER.findall(text)
    ]


def rust_numbers(text: str) -> list[Decimal]:
    """Return each floating-point literal in Rust source, such as `0.259_488` or `3.98e-34`."""
    return [Decimal(literal.replace('_', '')) for literal in RUST_NUMBER.findall(text)]


def configs(pattern: re.Pattern[str], text: str) -> list[Config]:
    """Return each `(n_b, n_o, L)` triple that `pattern` finds in `text`."""
    return [(int(b), int(o), int(depth)) for b, o, depth in pattern.findall(text)]


def section(text: str, start: str, end: str) -> str:
    """Return `text` from `start` up to the next `end`, failing when either is missing."""
    begin = text.find(start)
    require(begin >= 0, f'{start!r} not found')
    finish = text.find(end, begin)
    require(finish >= 0, f'{end!r} not found after {start!r}')
    return text[begin:finish]


def table_rows(block: str) -> list[list[str]]:
    """Split LaTeX tabular rows, which may wrap across lines, into whitespace-collapsed cells."""
    rows = (RULE.sub(' ', row) for row in block.split('\\\\')[:-1])
    return [[' '.join(cell.split()) for cell in row.split('&')] for row in rows if '&' in row]


def tex_table_one(text: str) -> list[Row]:
    """Parse the body rows of Table 1 (`tab:domain-profile`)."""
    table = section(text, r'\label{tab:domain-profile}', r'\bottomrule')
    body = table.split(r'\midrule', 1)[-1]
    rows: list[Row] = []
    for cells in table_rows(body):
        found = configs(TEX_CONFIG, cells[0])
        values = tuple(number for cell in cells[1:] for number in tex_numbers(cell))
        require(len(found) == 1 and len(values) == TABLE_COLUMNS, f'malformed Table 1 row {cells}')
        rows.append((found[0], values))
    require(rows, 'Table 1 has no rows')
    return rows


def certificate_table_one(source: str) -> list[Row]:
    """Parse the Table 1 rows the certificate asserts in `table_one_rows_match_the_simulation`."""
    block = section(source, 'fn table_one_rows_match_the_simulation', '];')
    return [
        ((int(b), int(o), int(depth)), tuple(rust_numbers(values)))
        for b, o, depth, values in RUST_TABLE_ROW.findall(block)
    ]


def proposition_rows(text: str) -> list[list[str]]:
    """Return the `quantity & value & configurations` rows of Proposition 5.2."""
    block = section(text, r'\label{prop:certificate}', r'\end{proposition}')
    return [cells for cells in table_rows(block) if len(cells) == 3]  # noqa: PLR2004


def min_acceptance(text: str) -> str:
    """Return the minimum acceptance Proposition 5.2 prints, such as `0.259488`."""
    values = [
        TEX_NUMBER.findall(cells[1])
        for cells in proposition_rows(text)
        if cells[0] == MIN_ACCEPTANCE_QUANTITY
    ]
    require(len(values) == 1 and len(values[0]) == 1, 'Proposition 5.2 prints no single min p_A')
    return values[0][0][0]


def verify_certificate(text: str, source: str) -> None:
    """Require the certificate to assert the printed Table 1 and Proposition 5.2 numbers.

    Comments are removed first, so a number only mentioned in a comment does not count.
    """
    source = RUST_COMMENT.sub('', source)
    printed_rows, proved_rows = tex_table_one(text), certificate_table_one(source)
    require(
        printed_rows == proved_rows,
        f'certificate Table 1 rows {proved_rows} differ from the .tex rows {printed_rows}',
    )
    proved_numbers, proved_configs = set(rust_numbers(source)), set(configs(RUST_CONFIG, source))
    rows = proposition_rows(text)
    require(rows, 'Proposition 5.2 has no rows')
    missing_numbers = sorted(
        {number for cells in rows for number in tex_numbers(cells[1])} - proved_numbers
    )
    missing_configs = sorted(
        {config for cells in rows for config in configs(TEX_CONFIG, cells[2])} - proved_configs
    )
    require(not missing_numbers, f'certificate never checks Proposition 5.2 {missing_numbers}')
    require(not missing_configs, f'certificate never checks configurations {missing_configs}')


def binary_entropy(p: Dynamic) -> Dynamic:
    """Enclosure of the binary entropy `h₂(p)` in bits; zero when `p` is certainly 0 or 1."""
    if p.b <= 0 or p.a >= 1:
        return iv.mpf(0)
    return -(p * iv.log(p) + (1 - p) * iv.log(1 - p)) / iv.log(2)


def coupling_scale(depth: int) -> Dynamic:
    """Enclosure of `u_L = φ⁻¹ √L`."""
    return (iv.sqrt(5) - 1) / 2 * iv.sqrt(depth)


def verify_constants(text: str, min_acceptance_text: str) -> None:
    """Prove the decimals of Section 1, Theorems 4.1 and 5.1 and Corollary 4.4 by intervals.

    Each decimal must still be printed in `text`, the `.tex`. `min_acceptance_text` is
    Proposition 5.2's printed `min p_A`, which the certificate proves.
    """

    def check(value: Dynamic, digits: int, expected: str, name: str) -> None:
        appears(text, expected, name)
        printed(value, digits, expected, name)

    check((iv.sqrt(5) - 1) / 2, 6, '0.618034', 'golden ratio inverse')
    first, sixth = coupling_scale(1), coupling_scale(6)
    check(first, 4, '0.6180', 'u_1')
    check(sixth, 4, '1.5139', 'u_6')
    check(coupling_scale(7), 4, '1.6352', 'u_7')
    check(iv.pi / 2, 4, '1.5708', 'pi / 2')
    sinc = iv.sin(sixth) / sixth
    check(sinc, 3, '0.659', 'sin(u_6) / u_6')
    require(sinc.a > iv.mpf('0.659').b, 'sin(u_L) / u_L bound')
    appears(text, '0.953', 'cos(phi^-1 / 2) bound')
    require(iv.cos(first / 2).b < iv.mpf('0.953').a, 'cos(phi^-1 / 2) bound')
    angles = {depth: coupling_scale(depth) / 2 for depth in (1, 3, 6)}
    check(binary_entropy((1 + iv.cos(angles[3])) / 2), 4, '0.3656', 'S(rho_B), L = 3')
    check(iv.sin(angles[1]), 3, '0.304', 'sin(theta_1)')
    check(iv.sin(angles[6]), 3, '0.687', 'sin(theta_6)')
    for depth, expected in ((3, '0.1968'), (6, '0.3738')):
        information = 1 - binary_entropy((1 + iv.sin(angles[depth])) / 2)
        check(information, 4, expected, f'I(B; O), L = {depth}')
    check((iv.mpf(3) / 4) ** 256 * iv.mpf(10) ** 32, 2, '1.04', '(3/4)^256 / 1e-32')
    acceptance = iv.mpf(min_acceptance_text)
    check(1 / acceptance, 3, '3.854', 'E[tau] maximum')
    exhaustion = (1 - acceptance) ** 256 * iv.mpf(10) ** 34
    check(exhaustion, 2, '3.98', '256-trial exhaustion / 1e-34')


def verify_specification_scope(text: str) -> None:
    """Keep implementation vocabulary out of the mathematical specification.

    A token matches only where no letter precedes it, so `emote` flags `emotes` but not `remote`.
    """
    scrubbed = re.sub(r'\\(?:eq)?ref\{eq:pool-cap\}|\\label\{eq:pool-cap\}', '', text)
    patterns = [
        (token, re.compile(rf'(?<![A-Za-z]){re.escape(token)}')) for token in FORBIDDEN_TOKENS
    ]
    hits = [
        f'{token!r} on line {number}'
        for number, line in enumerate(scrubbed.splitlines(), start=1)
        for token, pattern in patterns
        if pattern.search(line)
    ]
    require(not hits, 'implementation vocabulary in the .tex: ' + ', '.join(hits))


def verify_traceability(text: str, audit: str) -> None:
    """Require every `.tex` environment label to map to audited Lean theorems."""
    tex_labels = set(ENVIRONMENT_LABEL.findall(text))
    lean_labels = set(AUDIT_LABEL.findall(audit))
    require(tex_labels, 'no environment labels found in the .tex')
    missing = sorted(tex_labels - lean_labels)
    stale = sorted(lean_labels - tex_labels)
    require(not missing, f'.tex labels without audited Lean theorems: {missing}')
    require(not stale, f'audit labels missing from the .tex: {stale}')


def main() -> None:
    """Run every constant, scope, traceability and certificate check."""
    text = TEX_PATH.read_text(encoding='utf-8')
    verify_constants(text, min_acceptance(text))
    verify_specification_scope(text)
    verify_traceability(text, AUDIT_PATH.read_text(encoding='utf-8'))
    verify_certificate(text, CERTIFICATE_PATH.read_text(encoding='utf-8'))
    print('The .tex constants, scope, Lean traceability and certificate checks passed.')


if __name__ == '__main__':
    main()
