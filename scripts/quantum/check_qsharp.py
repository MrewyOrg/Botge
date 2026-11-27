"""Audit, lint, compile to Base QIR, test, and enforce full Q# coverage for BotgeQuantum.

`quantum/qsharp.json` targets `TargetProfile.Base`, the sidecar's profile, and everything here
compiles and runs under it. Base rejects Q# assertions on qubit state such as `CheckAllZero`, so the
`@Test()` suite checks static results and `quantum/tests/test_circuit.py` checks the state vector.
"""

import argparse
import importlib
import importlib.metadata
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import warnings
from contextlib import redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
QUANTUM_ROOT = REPO_ROOT / 'quantum'
SRC_DIR = QUANTUM_ROOT / 'src'
COVERAGE_OUT = REPO_ROOT / 'coverage' / 'qsharp' / 'coverage.json'
LINT_SCRIPT = Path(__file__).resolve().with_name('lint-qsharp.ts')
LANGUAGE_PACKAGE = REPO_ROOT / 'node_modules' / 'qsharp-lang' / 'package.json'
MIN_COVERAGE = 1.0
MIN_QSHARP_TESTS = 3
# Register widths `(n_b, n_o, L)` compiled to Base QIR: both 16-qubit maxima and the minimum.
QIR_WIDTHS: tuple[tuple[int, int, int], ...] = ((10, 6, 3), (9, 7, 3), (1, 1, 1))
QIR_CALL_RE = re.compile(r'call \w+ @__quantum__qis__(\w+?)__body\(')
STACK_GUARD_CASES: tuple[tuple[int, int, int, str], ...] = (
    (0, 1, 1, 'baseBits must be in 1..10.'),
    (11, 1, 1, 'baseBits must be in 1..10.'),
    (1, 0, 1, 'overlayBits must be in 1..7.'),
    (1, 8, 1, 'overlayBits must be in 1..7.'),
    (10, 7, 1, 'Total qubit width must not exceed 16.'),
    (1, 1, 0, 'steps must be in 1..6.'),
    (1, 1, 7, 'steps must be in 1..6.'),
)
STACK_GUARD_SOURCE = """
import {alias}.EntangleStack;
operation {name}(b : Int, o : Int, steps : Int) : Unit {{
    let _ = EntangleStack(b, o, steps);
}}
"""
CIRCUIT_GUARD_SOURCE = """
import {alias}.ApplyIsingRxCircuit;
operation {name}(b : Int, o : Int, steps : Int) : Unit {{
    use baseReg = Qubit[b];
    use overlayReg = Qubit[o];
    ApplyIsingRxCircuit(baseReg, overlayReg, steps);
    ResetAll(baseReg + overlayReg);
}}
"""

REQUIRED_LINTS: tuple[str, ...] = (
    'needlessParens',
    'divisionByZero',
    'redundantSemicolons',
    'discourageChainAssignment',
    'doubleEquality',
    'needlessOperation',
    'ambiguousUnaryOperatorAfterIf',
    'avoidNamespaceBlock',
)

CALLABLE_RE = re.compile(r'^\s*(?:@[^\n]+\s+)*(operation|function)\s+([A-Za-z_][A-Za-z0-9_]*)')
FACT_RE = re.compile(r'^(\s*)Fact\((.+),\s*(".*")\);\s*$')
TERNARY_RE = re.compile(
    r'^(?P<prefix>\s*let\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*)'
    r'(?P<cond>.+?)\s+\?\s+(?P<t>[^|]+?)\s+\|\s+(?P<f>[^;]+);\s*$'
)
IF_RE = re.compile(r'^(\s*)if\s+.+\{\s*$')
ELSE_RE = re.compile(r'^(\s*)\}\s*else\s*\{\s*$')
FOR_RE = re.compile(r'^(\s*)for\s+.+\{\s*$')
FOR_RANGE_RE = re.compile(
    r'^(\s*)for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+(?P<start>.+?)\.\.(?P<stop>[^.{]+?)\s*\{\s*$'
)

# Control flow the coverage probes do not model; instrumenting it would undercount branches.
UNMODELED_RE = re.compile(r'^(?:\}\s*)?(?P<keyword>elif|while|repeat|until|within|apply|fixup)\b')
OPEN_HEADER_RE = re.compile(r'^(?P<keyword>if|for)\b(?!.*\{$)')

STATIC_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'^namespace\s+'), 'avoidNamespaceBlock'),
    (re.compile(r'^open\s+'), 'deprecated `open` (use `import`)'),
    (re.compile(r'\bset\s+[A-Za-z_]'), 'deprecatedSet'),
    (re.compile(r'^newtype\s+'), 'deprecatedNewtype'),
    (re.compile(r'^borrow\s+'), 'deprecatedBorrow'),
    (re.compile(r'\bw/=?'), 'deprecatedWithOrUpdateExpr'),
    (re.compile(r'::'), 'deprecatedDoubleColonOperator'),
    (re.compile(r';;'), 'redundantSemicolons'),
    (re.compile(r'/\s*0(?:\b|\s*;)'), 'divisionByZero'),
    (
        re.compile(r'(?<![!<>=])=(?![=<>])\s*[A-Za-z_][A-Za-z0-9_]*\s*(?<![!<>=])=(?![=<>])'),
        'discourageChainAssignment',
    ),
    (
        re.compile(r'\b[0-9]+\.[0-9]+\s*(?:==|!=)|(?:==|!=)\s*[0-9]+\.[0-9]+\b'),
        'doubleEquality',
    ),
    (re.compile(r'^if\s*\(.+\)\s*\{$'), 'needlessParens in `if` condition'),
    (
        re.compile(r'^(?:let|mutable)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*\(.+\);\s*$'),
        'needlessParens on binding RHS',
    ),
)

COV_HELPERS = """function __QcovTern<'T>(tag : String, value : 'T) : 'T {
    Message(tag);
    return value;
}

function __QcovEmptyRange(tag : String, start : Int, stop : Int) : Unit {
    if start > stop {
        Message(tag);
    }
}

"""


class TargetProfileEnum(Protocol):
    """Subset of qdk TargetProfile enum used by check_qsharp."""

    Base: object


class BotgeQuantumNamespace(Protocol):
    """Q# callables exported under BotgeQuantum."""

    EntangleStack: object


class QdkCodeRoot(Protocol):
    """Dynamic root namespace exposed on qdk.Context.code."""

    BotgeQuantum: BotgeQuantumNamespace
    RunStackGuard: object
    RunCircuitGuard: object
    CovRunStackGuard: object
    CovRunCircuitGuard: object


class QdkContext(Protocol):
    """Typed surface of qdk.Context."""

    code: QdkCodeRoot

    def eval(self, source: str, *, save_events: bool = False) -> object:
        """Evaluate Q# source text inside this context."""

    def run(
        self,
        entry_expr: object,
        shots: int,
        *args: object,
        save_events: bool = False,
        seed: int | None = None,
    ) -> list[dict[str, object]]:
        """Execute a Q# callable or entry expression."""
        raise NotImplementedError

    def compile(self, entry_expr: object, *args: object) -> object:
        """Compile a Q# callable to QIR for the context's target profile."""


class ContextFactory(Protocol):
    """Callable constructor for qdk.Context."""

    def __call__(
        self,
        *,
        target_profile: object,
        project_root: str | None = None,
    ) -> QdkContext:
        """Construct an isolated Q# interpreter context."""
        raise NotImplementedError


class RunTestsCallable(Protocol):
    """Signature for qdk.test_utils.run_tests."""

    def __call__(
        self,
        *,
        context: QdkContext | None = None,
        seed: int | None = None,
        regex: str | None = None,
        verbose: int = 1,
    ) -> None:
        """Discover and execute @Test() Q# callables."""


@dataclass(frozen=True, slots=True)
class QdkModules:
    """Loaded QDK Python interfaces initialized with telemetry disabled."""

    context_cls: ContextFactory
    target_base: object
    qsharp_error: type[Exception]
    run_tests: RunTestsCallable


@dataclass(frozen=True, slots=True)
class CoverageSummary:
    """Measured Q# statement and branch coverage for one source file."""

    statements_covered: int
    statements_total: int
    branches_covered: int
    branches_total: int
    missing_statements: tuple[int, ...]
    missing_branches: tuple[str, ...]


@dataclass(slots=True)
class InstrumentationState:
    """Mutable line-tracking state for Q# coverage instrumentation."""

    out_lines: list[str]
    statements: set[int]
    branches: set[str]
    fact_map: dict[int, int]
    block_stack: list[tuple[str, int]]
    in_callable: bool = False
    brace_depth: int = 0


def load_qdk() -> QdkModules:
    """Disable QDK telemetry before importing QDK packages."""
    os.environ['QDK_PYTHON_TELEMETRY'] = 'none'
    qdk_mod = importlib.import_module('qdk')
    qsharp_mod = importlib.import_module('qdk.qsharp')
    test_utils_mod = importlib.import_module('qdk.test_utils')
    target_profile = cast('TargetProfileEnum', qsharp_mod.TargetProfile)
    return QdkModules(
        context_cls=cast('ContextFactory', qdk_mod.Context),
        target_base=target_profile.Base,
        qsharp_error=cast('type[Exception]', qsharp_mod.QSharpError),
        run_tests=cast('RunTestsCallable', test_utils_mod.run_tests),
    )


def parse_lint_entries(lints: list[object]) -> tuple[dict[str, str], dict[str, str]]:
    """Extract per-lint and per-group severity levels from qsharp.json."""
    levels: dict[str, str] = {}
    groups: dict[str, str] = {}
    for entry in lints:
        if not isinstance(entry, dict):
            msg = 'Each qsharp.json lint entry must be an object'
            raise SystemExit(msg)
        obj = cast('dict[str, object]', entry)
        level = obj.get('level')
        if not isinstance(level, str):
            msg = 'Each qsharp.json lint entry must specify a string level'
            raise SystemExit(msg)
        lint_name = obj.get('lint')
        if isinstance(lint_name, str):
            levels[lint_name] = level
        group_name = obj.get('group')
        if isinstance(group_name, str):
            groups[group_name] = level
    return levels, groups


def verify_manifest() -> dict[str, object]:
    """Verify quantum/qsharp.json enforces the Base target profile and all strict lints."""
    raw = cast('object', json.loads((QUANTUM_ROOT / 'qsharp.json').read_text(encoding='utf-8')))
    if not isinstance(raw, dict):
        msg = 'qsharp.json must contain a JSON object'
        raise SystemExit(msg)
    manifest = cast('dict[str, object]', raw)
    if manifest.get('targetProfile') != 'base':
        msg = 'qsharp.json must set "targetProfile": "base"'
        raise SystemExit(msg)
    lints = manifest.get('lints')
    if not isinstance(lints, list):
        msg = 'qsharp.json must configure strict lint rules'
        raise SystemExit(msg)

    levels, groups = parse_lint_entries(cast('list[object]', lints))
    if groups.get('deprecations') != 'error':
        msg = 'qsharp.json must set group "deprecations" to "error"'
        raise SystemExit(msg)
    missing = [name for name in REQUIRED_LINTS if levels.get(name) != 'error']
    if missing:
        msg = f'qsharp.json missing "error" level for lints: {", ".join(missing)}'
        raise SystemExit(msg)
    return manifest


def strip_qsharp_comments(line: str) -> str:
    """Remove trailing line comments outside string literals."""
    in_string = False
    escaped = False
    for idx in range(len(line) - 1):
        ch = line[idx]
        if escaped:
            escaped = False
            continue
        if ch == '\\' and in_string:
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string and line[idx : idx + 2] == '//':
            return line[:idx]
    return line


def has_doc_summary(lines: Sequence[str], callable_index: int) -> bool:
    """Return whether a callable has an immediately preceding /// # Summary block."""
    pos = callable_index - 2
    found_summary = False
    while pos >= 0:
        stripped = lines[pos].lstrip()
        if stripped.startswith('///'):
            if stripped.startswith('/// # Summary'):
                found_summary = True
            pos -= 1
            continue
        if stripped.startswith('@'):
            pos -= 1
            continue
        break
    return found_summary


def lint_qsharp_sources(paths: Sequence[Path]) -> list[str]:
    """Run static Q# lint checks matching qsc_linter error rules across source files."""
    violations: list[str] = []
    for path in paths:
        lines = path.read_text(encoding='utf-8').splitlines()
        rel = path.relative_to(REPO_ROOT)
        for index, raw in enumerate(lines, start=1):
            code = strip_qsharp_comments(raw)
            stripped = code.strip()
            if stripped:
                violations.extend(
                    f'{rel}:{index}: {label}'
                    for pattern, label in STATIC_PATTERNS
                    if pattern.search(stripped)
                )
            match = CALLABLE_RE.match(raw)
            if match is not None and not has_doc_summary(lines, index):
                violations.append(
                    f'{rel}:{index}: callable `{match.group(2)}` missing /// # Summary'
                )
    return violations


def qir_gate_counts(qir: str) -> dict[str, int]:
    """Count quantum instruction calls in QIR text by gate name."""
    counts: dict[str, int] = {}
    for gate in QIR_CALL_RE.findall(qir):
        counts[gate] = counts.get(gate, 0) + 1
    return counts


def verify_base_qir(context: QdkContext) -> None:
    """Compile `EntangleStack` to Base QIR and check the `prop:compile` gate tally.

    Each register qubit gets one `H`, one `Rx` and one measurement, and every cross-register pair
    one `Rzz`, for `n_b n_o + 2 (n_b + n_o) <= 96` gates before measurement.
    """
    entangle_stack = context.code.BotgeQuantum.EntangleStack
    for base_bits, overlay_bits, steps in QIR_WIDTHS:
        qir = str(context.compile(entangle_stack, base_bits, overlay_bits, steps))
        if '"qir_profiles"="base_profile"' not in qir:
            msg = f'EntangleStack{(base_bits, overlay_bits, steps)} did not compile to Base QIR'
            raise SystemExit(msg)
        width = base_bits + overlay_bits
        expected = {'h': width, 'rzz': base_bits * overlay_bits, 'rx': width, 'm': width}
        counts = qir_gate_counts(qir)
        if counts != expected:
            msg = (
                f'EntangleStack{(base_bits, overlay_bits, steps)} QIR gates {counts} '
                f'differ from {expected}'
            )
            raise SystemExit(msg)


def assert_fact_failure(
    context: QdkContext,
    callable_obj: object,
    qsharp_error: type[Exception],
    args: tuple[object, ...],
    expected_substring: str,
) -> None:
    """Invoke a Q# callable expecting QSharpError containing expected_substring."""
    try:
        context.run(callable_obj, 1, *args)
    except qsharp_error as error:
        if expected_substring not in str(error):
            msg = f'Unexpected error for {args}: {error}'
            raise SystemExit(msg) from error
    else:
        msg = f'Expected Fact failure for {args}'
        raise SystemExit(msg)


def run_fact_guard_assertions(qdk_mods: QdkModules, context: QdkContext) -> None:
    """Assert every Fact guard on EntangleStack and ApplyIsingRxCircuit rejects invalid args."""
    entangle_stack = context.code.BotgeQuantum.EntangleStack
    guard_ctx = qdk_mods.context_cls(
        project_root=str(QUANTUM_ROOT),
        target_profile=qdk_mods.target_base,
    )
    guard_ctx.eval(CIRCUIT_GUARD_SOURCE.format(alias='BotgeQuantum', name='RunCircuitGuard'))
    circuit_guard = guard_ctx.code.RunCircuitGuard
    for base_bits, overlay_bits, steps, expected in STACK_GUARD_CASES:
        args = (base_bits, overlay_bits, steps)
        assert_fact_failure(context, entangle_stack, qdk_mods.qsharp_error, args, expected)
        assert_fact_failure(guard_ctx, circuit_guard, qdk_mods.qsharp_error, args, expected)


def is_executable_statement(stripped: str) -> bool:
    """Return whether a stripped Q# line starts a regular executable statement."""
    if not stripped or stripped.startswith('//'):
        return False
    starts_statement = stripped.endswith((';', '{')) or stripped.startswith(
        ('let ', 'mutable ', 'use ', 'return ')
    )
    if not starts_statement:
        return False
    is_closing_arglist = (
        stripped.endswith(');')
        and not stripped.startswith(('let ', 'mutable ', 'use ', 'return '))
        and '(' not in stripped.split(');', 1)[0]
    )
    return not is_closing_arglist


def instrument_closing_brace(
    state: InstrumentationState,
    rel_name: str,
    raw: str,
    indent: str,
) -> None:
    """Instrument closing braces for if-blocks and callable bodies."""
    if not state.block_stack:
        state.out_lines.append(raw)
        if state.brace_depth <= 0:
            state.in_callable = False
        return
    kind, owner_line = state.block_stack.pop()
    if kind == 'if':
        state.out_lines.append(f'{indent}}} else {{')
        state.out_lines.append(f'{indent}    Message("__QCOV_B__:{rel_name}:{owner_line}:F");')
        state.out_lines.append(raw)
    else:
        state.out_lines.append(raw)


def instrument_ternary(
    state: InstrumentationState,
    rel_name: str,
    idx: int,
    indent: str,
    match: re.Match[str],
) -> None:
    """Instrument a let-bound ternary expression to trace both T and F branches."""
    state.statements.add(idx)
    state.branches.update((f'{idx}:T', f'{idx}:F'))
    state.out_lines.append(f'{indent}Message("__QCOV_S__:{rel_name}:{idx}");')
    prefix = match.group('prefix')
    cond = match.group('cond').strip()
    t_expr = match.group('t').strip()
    f_expr = match.group('f').strip()
    state.out_lines.append(
        f'{prefix}{cond} ? __QcovTern("__QCOV_B__:{rel_name}:{idx}:T", {t_expr}) '
        f'| __QcovTern("__QCOV_B__:{rel_name}:{idx}:F", {f_expr});'
    )


def instrument_block_header(
    state: InstrumentationState,
    rel_name: str,
    idx: int,
    raw: str,
    indent: str,
) -> bool:
    """Instrument `if`, `else`, `for`, or closing `}` lines; return whether handled."""
    stripped = strip_qsharp_comments(raw).strip()
    if ELSE_RE.match(raw) is not None and state.block_stack and state.block_stack[-1][0] == 'if':
        _, if_line = state.block_stack.pop()
        state.out_lines.append(raw)
        state.out_lines.append(f'{indent}    Message("__QCOV_B__:{rel_name}:{if_line}:F");')
        state.block_stack.append(('else', if_line))
        return True
    if stripped == '}':
        instrument_closing_brace(state, rel_name, raw, indent)
        return True
    if IF_RE.match(raw) is not None:
        state.statements.add(idx)
        state.branches.update((f'{idx}:T', f'{idx}:F'))
        state.out_lines.append(f'{indent}Message("__QCOV_S__:{rel_name}:{idx}");')
        state.out_lines.append(raw)
        state.out_lines.append(f'{indent}    Message("__QCOV_B__:{rel_name}:{idx}:T");')
        state.block_stack.append(('if', idx))
        return True
    if FOR_RE.match(raw) is not None:
        state.statements.add(idx)
        state.out_lines.append(f'{indent}Message("__QCOV_S__:{rel_name}:{idx}");')
        range_match = FOR_RANGE_RE.match(raw)
        if range_match is not None:
            state.branches.update((f'{idx}:T', f'{idx}:F'))
            start_expr = range_match.group('start').strip()
            stop_expr = range_match.group('stop').strip()
            state.out_lines.append(
                f'{indent}__QcovEmptyRange('
                f'"__QCOV_B__:{rel_name}:{idx}:F", {start_expr}, {stop_expr});'
            )
        else:
            state.branches.add(f'{idx}:T')
        state.out_lines.append(raw)
        state.out_lines.append(f'{indent}    Message("__QCOV_B__:{rel_name}:{idx}:T");')
        state.block_stack.append(('for', idx))
        return True
    return False


def instrument_line(
    state: InstrumentationState,
    rel_name: str,
    idx: int,
    raw: str,
) -> None:
    """Instrument one Q# line inside an operation or function."""
    code = strip_qsharp_comments(raw)
    stripped = code.strip()
    indent = raw[: len(raw) - len(raw.lstrip())]
    was_in_body = state.brace_depth > 0
    state.brace_depth += code.count('{') - code.count('}')

    if not was_in_body:
        state.out_lines.append(raw)
        return

    unmodeled = UNMODELED_RE.match(stripped) or OPEN_HEADER_RE.match(stripped)
    if unmodeled is not None:
        msg = (
            f'{rel_name}:{idx}: coverage probes do not model `{unmodeled.group("keyword")}` '
            'here; use single-line `if`/`else`/`for` blocks or extend the instrumenter'
        )
        raise SystemExit(msg)

    if instrument_block_header(state, rel_name, idx, raw, indent):
        return

    tern_match = TERNARY_RE.match(raw)
    if tern_match is not None:
        instrument_ternary(state, rel_name, idx, indent, tern_match)
        return

    if FACT_RE.match(raw) is not None:
        state.statements.add(idx)
        state.branches.update((f'{idx}:T', f'{idx}:F'))
        state.out_lines.append(f'{indent}Message("__QCOV_S__:{rel_name}:{idx}");')
        state.fact_map[len(state.out_lines) + 1] = idx
        state.out_lines.append(raw)
        state.out_lines.append(f'{indent}Message("__QCOV_B__:{rel_name}:{idx}:T");')
        return

    if is_executable_statement(stripped):
        state.statements.add(idx)
        state.out_lines.append(f'{indent}Message("__QCOV_S__:{rel_name}:{idx}");')
        state.out_lines.append(raw)
        if stripped.startswith('Fact('):
            state.branches.update((f'{idx}:T', f'{idx}:F'))
            state.fact_map[len(state.out_lines)] = idx
            state.out_lines.append(f'{indent}Message("__QCOV_B__:{rel_name}:{idx}:T");')
        return

    state.out_lines.append(raw)


def instrument_qsharp_file(
    source_path: Path,
    rel_name: str,
) -> tuple[str, set[int], set[str], dict[int, int]]:
    """Instrument a Q# source file with Message-based statement and branch probes."""
    lines = source_path.read_text(encoding='utf-8').splitlines()
    insert_at = 0
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(('import ', 'export ', '//')) or not stripped:
            insert_at = idx + 1
        else:
            break

    state = InstrumentationState(
        out_lines=[],
        statements=set(),
        branches=set(),
        fact_map={},
        block_stack=[],
    )
    for idx, raw in enumerate(lines, start=1):
        if idx - 1 == insert_at:
            state.out_lines.extend(COV_HELPERS.splitlines())
        if CALLABLE_RE.match(raw) is not None and not state.in_callable:
            state.in_callable = True
            state.brace_depth = 0
        if not state.in_callable:
            state.out_lines.append(raw)
            continue
        instrument_line(state, rel_name, idx, raw)

    return '\n'.join(state.out_lines) + '\n', state.statements, state.branches, state.fact_map


def collect_test_callables(module: object) -> list[Callable[..., object]]:
    """Collect Q# @Test() callables exposed under context.code."""
    found: list[Callable[..., object]] = []
    for name in dir(module):
        attr = getattr(module, name)
        if callable(attr) and getattr(attr, '__is_test__', False):
            found.append(attr)
        elif type(attr).__name__ in ('module', 'SimpleNamespace'):
            found.extend(collect_test_callables(attr))
    return found


def record_messages(
    messages: Iterable[object],
    rel_name: str,
    hit_statements: set[int],
    hit_branches: set[str],
) -> None:
    """Parse statement and branch coverage tags from one shot's messages."""
    for item in messages:
        msg = str(item)
        if msg.startswith(f'__QCOV_S__:{rel_name}:'):
            hit_statements.add(int(msg.rsplit(':', 1)[-1]))
        elif msg.startswith(f'__QCOV_B__:{rel_name}:'):
            parts = msg.split(':')
            hit_branches.add(f'{parts[-2]}:{parts[-1]}')


def exercise_instrumented_fact_guards(
    qdk_mods: QdkModules,
    cov_ctx: QdkContext,
    fact_maps: dict[str, dict[int, int]],
    hit_branches: dict[str, set[str]],
) -> None:
    """Run negative Fact guard tests on the instrumented context and record false branches."""
    cov_ctx.eval(STACK_GUARD_SOURCE.format(alias='BotgeQuantum', name='CovRunStackGuard'))
    cov_ctx.eval(CIRCUIT_GUARD_SOURCE.format(alias='BotgeQuantum', name='CovRunCircuitGuard'))
    guards = (cov_ctx.code.CovRunStackGuard, cov_ctx.code.CovRunCircuitGuard)
    frame_re = re.compile(r'at\s+\S+\s+in\s+[^:\n]+?(src/[^:\n]+\.qs):(\d+):\d+')
    for fn in guards:
        for base_bits, overlay_bits, steps, _ in STACK_GUARD_CASES:
            try:
                cov_ctx.run(fn, 1, base_bits, overlay_bits, steps, save_events=True)
            except qdk_mods.qsharp_error as error:
                for rel_match, line_str in frame_re.findall(str(error)):
                    if rel_match in fact_maps:
                        orig = fact_maps[rel_match].get(int(line_str))
                        if orig is not None:
                            hit_branches[rel_match].add(f'{orig}:F')


def copy_qsharp_project(destination: Path) -> None:
    """Copy only the Q# manifest and sources, never `proofs/` and its Lake cache."""
    shutil.copy2(QUANTUM_ROOT / 'qsharp.json', destination / 'qsharp.json')
    shutil.copytree(SRC_DIR, destination / 'src')


def run_coverage_gate(qdk_mods: QdkModules) -> dict[str, CoverageSummary]:
    """Measure Q# statement and branch coverage across production .qs files and enforce 100%."""
    prod_files = sorted(
        path for path in SRC_DIR.rglob('*.qs') if not path.name.endswith('Tests.qs')
    )
    if not prod_files:
        msg = 'No production .qs files found under quantum/src/'
        raise SystemExit(msg)

    summaries: dict[str, CoverageSummary] = {}
    with tempfile.TemporaryDirectory(prefix='botge-qcov-') as tmp:
        tmp_root = Path(tmp) / 'quantum'
        tmp_root.mkdir()
        copy_qsharp_project(tmp_root)

        expected_statements: dict[str, set[int]] = {}
        expected_branches: dict[str, set[str]] = {}
        fact_maps: dict[str, dict[int, int]] = {}
        hit_statements: dict[str, set[int]] = {}
        hit_branches: dict[str, set[str]] = {}

        for src in prod_files:
            rel = str(src.relative_to(QUANTUM_ROOT))
            instrumented, stmts, brs, fact_map = instrument_qsharp_file(src, rel)
            (tmp_root / rel).write_text(instrumented, encoding='utf-8')
            expected_statements[rel] = stmts
            expected_branches[rel] = brs
            fact_maps[rel] = fact_map
            hit_statements[rel] = set()
            hit_branches[rel] = set()

        cov_ctx = qdk_mods.context_cls(
            project_root=str(tmp_root),
            target_profile=qdk_mods.target_base,
        )
        for test_fn in collect_test_callables(cov_ctx.code):
            for shot in cov_ctx.run(test_fn, 1, seed=42, save_events=True):
                msgs = cast('list[object]', shot.get('messages', []))
                for rel in expected_statements:
                    record_messages(msgs, rel, hit_statements[rel], hit_branches[rel])

        exercise_instrumented_fact_guards(qdk_mods, cov_ctx, fact_maps, hit_branches)

        for rel in sorted(expected_statements):
            exp_s = expected_statements[rel]
            exp_b = expected_branches[rel]
            cov_s = hit_statements[rel] & exp_s
            cov_b = hit_branches[rel] & exp_b
            summaries[rel] = CoverageSummary(
                statements_covered=len(cov_s),
                statements_total=len(exp_s),
                branches_covered=len(cov_b),
                branches_total=len(exp_b),
                missing_statements=tuple(sorted(exp_s - cov_s)),
                missing_branches=tuple(sorted(exp_b - cov_b)),
            )

    return summaries


def write_and_enforce_coverage(summaries: dict[str, CoverageSummary]) -> None:
    """Persist Q# coverage report and fail if statements or branches fall below 100%."""
    COVERAGE_OUT.parent.mkdir(parents=True, exist_ok=True)
    report_payload = {
        rel: {
            'statements_covered': summary.statements_covered,
            'statements_total': summary.statements_total,
            'statement_pct': round(
                100.0 * summary.statements_covered / max(1, summary.statements_total), 2
            ),
            'branches_covered': summary.branches_covered,
            'branches_total': summary.branches_total,
            'branch_pct': round(
                100.0 * summary.branches_covered / max(1, summary.branches_total), 2
            ),
            'missing_statements': list(summary.missing_statements),
            'missing_branches': list(summary.missing_branches),
        }
        for rel, summary in summaries.items()
    }
    COVERAGE_OUT.write_text(json.dumps(report_payload, indent=2) + '\n', encoding='utf-8')

    failed = False
    for rel, summary in summaries.items():
        stmt_ratio = summary.statements_covered / max(1, summary.statements_total)
        branch_ratio = summary.branches_covered / max(1, summary.branches_total)
        print(
            f'Q# coverage {rel}: '
            f'statements {summary.statements_covered}/{summary.statements_total} '
            f'({stmt_ratio:.1%}), '
            f'branches {summary.branches_covered}/{summary.branches_total} ({branch_ratio:.1%})'
        )
        if summary.missing_statements:
            print(f'  missing statements: {list(summary.missing_statements)}')
        if summary.missing_branches:
            print(f'  missing branches: {list(summary.missing_branches)}')
        if stmt_ratio < MIN_COVERAGE or branch_ratio < MIN_COVERAGE:
            failed = True

    if failed:
        msg = 'Q# coverage below 100% threshold'
        raise SystemExit(msg)


def compile_without_warnings(
    qdk_mods: QdkModules,
    project_root: Path,
    target_profile: object,
) -> QdkContext:
    """Compile one Q# project and fail on any compiler warning."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        context = qdk_mods.context_cls(
            project_root=str(project_root),
            target_profile=target_profile,
        )
    if caught:
        details = '; '.join(str(item.message) for item in caught)
        msg = f'Q# compiler emitted warning(s): {details}'
        raise SystemExit(msg)
    return context


def verify_language_package() -> str:
    """Require the npm `qsharp-lang` linter to match the Python `qdk` compiler version.

    Both ship the same Q# compiler, so a version mismatch would lint different rules than the
    simulator compiles.
    """
    try:
        raw = cast('object', json.loads(LANGUAGE_PACKAGE.read_text(encoding='utf-8')))
    except FileNotFoundError:
        msg = 'qsharp-lang is not installed; run `npm ci` first'
        raise SystemExit(msg) from None
    version = cast('dict[str, object]', raw).get('version') if isinstance(raw, dict) else None
    expected = importlib.metadata.version('qdk')
    if version != expected:
        msg = f'qsharp-lang {version} must match qdk {expected}'
        raise SystemExit(msg)
    return expected


def run_language_service_lints() -> None:
    """Lint quantum/ with the Q# language service, as VS Code does, under Base and Unrestricted."""
    node = shutil.which('node')
    if node is None:
        msg = 'Node is required for the Q# language service lints'
        raise SystemExit(msg)
    result = subprocess.run(  # noqa: S603 - Resolved Node, fixed repository script and project.
        (node, str(LINT_SCRIPT), str(QUANTUM_ROOT)),
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit((result.stdout + result.stderr).strip() or 'Q# lints failed')
    print(result.stdout.strip())


def main() -> None:
    """Validate qsharp.json, run strict lints, Base QIR, the @Test() suite, and 100% coverage."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    verify_manifest()

    lint_errors = lint_qsharp_sources(sorted(SRC_DIR.rglob('*.qs')))
    if lint_errors:
        raise SystemExit('\n'.join(lint_errors))
    verify_language_package()
    run_language_service_lints()

    qdk_mods = load_qdk()
    context = compile_without_warnings(qdk_mods, QUANTUM_ROOT, qdk_mods.target_base)
    verify_base_qir(context)

    tests = collect_test_callables(context.code)
    if len(tests) < MIN_QSHARP_TESTS:
        msg = f'Expected at least {MIN_QSHARP_TESTS} @Test() Q# callables, found {len(tests)}'
        raise SystemExit(msg)

    with redirect_stdout(io.StringIO()) as test_out:
        qdk_mods.run_tests(context=context, seed=42, verbose=2)
    print(test_out.getvalue().strip())

    run_fact_guard_assertions(qdk_mods, context)
    summaries = run_coverage_gate(qdk_mods)
    write_and_enforce_coverage(summaries)


if __name__ == '__main__':
    main()
