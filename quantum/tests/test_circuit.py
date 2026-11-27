"""State-vector tests of the Q# Ising-Rx circuit, run under `TargetProfile.Base`.

Base rejects Q# assertions on qubit state (`CheckAllZero` is a dynamic bool), so these tests read
the simulator's state vector from Python instead, as Microsoft's `samples/testing/states` does. The
dump is big-endian: the first allocated qubit is the most significant bit, so with the base
register allocated first, amplitude `x * N_o + z` belongs to base pattern `x` and overlay pattern
`z`.
"""

import cmath
import functools
import gc
import importlib
import math
import os
import re
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Protocol, cast, override

import numpy as np
from numpy.typing import NDArray

type State = NDArray[np.complex128]
type Distribution = NDArray[np.float64]

QUANTUM_DIR: Final[Path] = Path(__file__).resolve().parent.parent
TOLERANCE: Final[float] = 1e-12
GOLDEN_INVERSE: Final[float] = (math.sqrt(5.0) - 1.0) / 2.0
MAX_STEPS: Final[int] = 6


class StateDump(Protocol):
    """Typed surface of `qdk.qsharp.StateDump`."""

    def as_dense_state(self) -> list[complex]:
        """Return every amplitude in big-endian basis order."""
        ...


class QdkContext(Protocol):
    """Typed surface of `qdk.Context` used by these tests."""

    def eval(self, source: str) -> object:
        """Evaluate Q# statements, keeping their qubits allocated."""
        ...

    def dump_machine(self) -> StateDump:
        """Return the simulator state."""
        ...


class ContextFactory(Protocol):
    """Callable constructor for `qdk.Context`."""

    def __call__(self, *, target_profile: object, project_root: str) -> QdkContext:
        """Compile the project into an isolated interpreter."""
        ...


def load_base_context_factory() -> tuple[ContextFactory, object]:
    """Disable telemetry, then load `qdk.Context` and `TargetProfile.Base`."""
    os.environ['QDK_PYTHON_TELEMETRY'] = 'none'
    qdk = importlib.import_module('qdk')
    qsharp = importlib.import_module('qdk.qsharp')
    return cast('ContextFactory', qdk.Context), cast('object', qsharp.TargetProfile.Base)


CONTEXT, BASE = load_base_context_factory()


def simulate(statements: str) -> State:
    """Run Q# statements under Base in a fresh project context and return the state vector."""
    context = CONTEXT(target_profile=BASE, project_root=str(QUANTUM_DIR))
    context.eval(statements)
    return np.asarray(context.dump_machine().as_dense_state(), dtype=np.complex128)


def circuit(base_bits: int, overlay_bits: int, steps: int, after: str = '') -> str:
    """Q# that allocates `B` then `O`, applies `U_L`, then runs `after`."""
    return (
        f'use b = Qubit[{base_bits}]; use o = Qubit[{overlay_bits}]; '
        f'BotgeQuantum.ApplyIsingRxCircuit(b, o, {steps}); {after}'
    )


def coupling(steps: int) -> float:
    """Return `u_L = phi^-1 sqrt(L)` (Definition 3.1)."""
    return GOLDEN_INVERSE * math.sqrt(steps)


def distance(left: State, right: State) -> float:
    """Return the largest amplitude difference between two equal-length state vectors."""
    if left.shape != right.shape:
        msg = f'State sizes differ: {left.size} and {right.size}'
        raise ValueError(msg)
    return float(np.max(np.abs(left - right)))


def basis(index: int, size: int) -> State:
    """Return the computational basis state `|index>` of a `size`-amplitude register."""
    state = np.zeros(size, dtype=np.complex128)
    state[index] = 1.0
    return state


def purity(state: State, base_bits: int, overlay_bits: int) -> float:
    """Return `Tr(rho_B^2) = Tr(rho_O^2) = sum s^4` over the Schmidt coefficients `s`.

    Row `x`, column `z` of the reshaped dump is the amplitude of base pattern `x`, overlay `z`.
    """
    coefficients = np.linalg.svd(state.reshape(1 << base_bits, 1 << overlay_bits), compute_uv=False)
    return float(np.sum(coefficients**4))


class IsingRxStateTests(unittest.TestCase):
    """Check `ApplyIsingRxCircuit` against Definition 3.1 and its corollaries, under Base."""

    def test_adjoint_restores_zero(self) -> None:
        """`U_L^dagger U_L = I` across depths, asymmetric widths and both 16-qubit maxima."""
        cases = [
            *((1, 1, steps) for steps in range(1, MAX_STEPS + 1)),
            *((3, 2, steps) for steps in range(1, MAX_STEPS + 1)),
            (2, 5, 4),
            (10, 6, 3),
            (9, 7, 6),
        ]
        for base_bits, overlay_bits, steps in cases:
            with self.subTest(base=base_bits, overlay=overlay_bits, steps=steps):
                state = simulate(
                    circuit(
                        base_bits,
                        overlay_bits,
                        steps,
                        f'Adjoint BotgeQuantum.ApplyIsingRxCircuit(b, o, {steps});',
                    )
                )
                size = 1 << (base_bits + overlay_bits)
                self.assertLess(distance(state, basis(0, size)), TOLERANCE)

    def test_controlled_acts_only_on_a_set_control(self) -> None:
        """A |0> control is the identity, a |1> control applies `U_L`, and `Ctl + Adj` undoes it."""
        target = simulate(circuit(2, 3, 4))
        size = len(target)
        allocate = 'use c = Qubit(); use b = Qubit[2]; use o = Qubit[3]; '
        apply = 'Controlled BotgeQuantum.ApplyIsingRxCircuit([c], (b, o, 4)); '
        undo = 'Controlled Adjoint BotgeQuantum.ApplyIsingRxCircuit([c], (b, o, 4)); '

        idle = simulate(allocate + apply)
        self.assertLess(distance(idle, basis(0, 2 * size)), TOLERANCE)

        active = simulate(f'{allocate}X(c); {apply}')
        self.assertLess(
            distance(active, np.concatenate((np.zeros_like(target), target))), TOLERANCE
        )

        restored = simulate(f'{allocate}X(c); {apply}{undo}X(c);')
        self.assertLess(distance(restored, basis(0, 2 * size)), TOLERANCE)

    def test_two_by_two_closed_form(self) -> None:
        """`|psi_L> = e^(i pi/4) (cos(u_L/4) |++> + sin(u_L/4) |-->)` exactly (Corollary 4.4)."""
        plus_plus = np.array((0.5, 0.5, 0.5, 0.5), dtype=np.complex128)
        minus_minus = np.array((0.5, -0.5, -0.5, 0.5), dtype=np.complex128)
        phase = np.complex128(cmath.exp(1j * math.pi / 4.0))
        for steps in range(1, MAX_STEPS + 1):
            with self.subTest(steps=steps):
                angle = coupling(steps) / 4.0
                expected = phase * (math.cos(angle) * plus_plus + math.sin(angle) * minus_minus)
                state = simulate(circuit(1, 1, steps))
                self.assertLess(distance(state, expected), TOLERANCE)
                # Born law: P(0, 0) = P(1, 1) = (1 + sin(theta_L)) / 4 with theta_L = u_L / 2.
                agree = (1.0 + math.sin(coupling(steps) / 2.0)) / 4.0
                self.assertAlmostEqual(abs(state[0]) ** 2, agree, places=12)
                self.assertAlmostEqual(abs(state[3]) ** 2, agree, places=12)

    def test_complement_invariance(self) -> None:
        """Flipping every qubit leaves `|psi_L>` unchanged (Theorem 4.3)."""
        for base_bits, overlay_bits, steps in ((3, 2, 5), (4, 4, 2), (1, 7, 6)):
            with self.subTest(base=base_bits, overlay=overlay_bits, steps=steps):
                state = simulate(circuit(base_bits, overlay_bits, steps))
                flipped = simulate(
                    circuit(base_bits, overlay_bits, steps, 'for q in b + o { X(q); }')
                )
                self.assertLess(distance(state, flipped), TOLERANCE)

    def test_registers_are_entangled(self) -> None:
        """Reduced states are mixed: purity `(1 + cos^2 theta_L) / 2` at 2x2, below 1 when wider."""
        for steps in range(1, MAX_STEPS + 1):
            with self.subTest(base=1, overlay=1, steps=steps):
                cosine = math.cos(coupling(steps) / 2.0)
                self.assertAlmostEqual(
                    purity(simulate(circuit(1, 1, steps)), 1, 1), (1.0 + cosine**2) / 2.0, places=12
                )
        for base_bits, overlay_bits, steps in ((3, 2, 3), (2, 5, 1), (10, 6, 3)):
            with self.subTest(base=base_bits, overlay=overlay_bits, steps=steps):
                value = purity(
                    simulate(circuit(base_bits, overlay_bits, steps)), base_bits, overlay_bits
                )
                self.assertGreater(value, 1.0 / (1 << min(base_bits, overlay_bits)))
                self.assertLess(value, 1.0 - 1e-3)

    def test_helpers_reject_mismatched_states(self) -> None:
        """Comparing state vectors of different sizes is an error, not a silent truncation."""
        with self.assertRaisesRegex(ValueError, 'State sizes differ: 1 and 2'):
            distance(basis(0, 1), basis(0, 2))


SPECIFICATION: Final[Path] = QUANTUM_DIR / 'docs' / 'botge-quantum.tex'
TABLE_COLUMNS: Final[tuple[str, ...]] = (
    'S_2',
    'p_A^min',
    'min_entropy',
    'ratio',
    'information',
    'min_probability',
)
TABLE_HEADER: Final[tuple[str, ...]] = (
    r'\((n_b, n_o, L)\)',
    r'\(S_2(\rho_B)\) [bits]',
    r'\(p_A^{\min}\)',
    r'\(\min H/n\)',
    'Max/min ratio',
    r'\(I(B; O)\) [bits]',
    r'\(\min P_L\)',
)
# Proposition 5.2 rows printed with `\approx` at named configurations, by quantity.
CERTIFIED_QUANTITIES: Final[dict[str, str]] = {
    r'\( \min p_A \)': 'p_A^min',
    r'\( \min \Prob(B < N_b / 2, O < N_o / 2) \)': 'half_quadrant',
    r'\( I(B; O) \)': 'information',
    r'median of \( 2^{H(O \mid B = b)} \) over \( b \)': 'median_effective',
}
RULE: Final[re.Pattern[str]] = re.compile(r'\\(?:top|mid|bottom)rule\b')
CONFIG_PATTERN: Final[re.Pattern[str]] = re.compile(r'\((\d+), (\d+), (\d+)\)')
PRINTED_PATTERN: Final[re.Pattern[str]] = re.compile(
    r'(\d+)\.(\d+)(?:\s*\\times\s*10\^\{(-?\d+)\})?'
)

type Config = tuple[int, int, int]


@dataclass(frozen=True, slots=True)
class Printed:
    """A decimal printed in the specification and the size of one unit in its last digit."""

    value: float
    unit: float


@dataclass(frozen=True, slots=True)
class SpecValue:
    """One printed metric of one configuration."""

    config: Config
    metric: str
    printed: Printed


def printed(text: str) -> Printed:
    r"""Parse a printed decimal such as `0.2010` or `1.22 \times 10^{-1}`."""
    match = PRINTED_PATTERN.search(text)
    if match is None:
        msg = f'No printed decimal in {text!r}'
        raise ValueError(msg)
    whole, fraction, exponent = match.groups()
    scale = 10.0 ** int(exponent or '0')
    return Printed(float(f'{whole}.{fraction}') * scale, 10.0 ** -len(fraction) * scale)


def config_of(text: str) -> list[Config]:
    """Return every `(n_b, n_o, L)` triple written in `text`."""
    return [(int(b), int(o), int(steps)) for b, o, steps in CONFIG_PATTERN.findall(text)]


def section(text: str, start: str, end: str) -> str:
    """Return the specification text from `start` up to the next `end`."""
    begin = text.index(start)
    return text[begin : text.index(end, begin)]


def table_rows(block: str) -> list[list[str]]:
    """Split LaTeX tabular rows, which may wrap across lines, into whitespace-collapsed cells."""
    rows = (RULE.sub(' ', row) for row in block.split('\\\\')[:-1])
    return [[' '.join(cell.split()) for cell in row.split('&')] for row in rows if '&' in row]


def table_one(text: str) -> list[SpecValue]:
    """Parse every metric of Table 1 (`tab:domain-profile`)."""
    block = section(text, r'\label{tab:domain-profile}', r'\bottomrule')
    header, *body = table_rows(block.split(r'\toprule', 1)[-1])
    if tuple(header) != TABLE_HEADER:
        msg = f'Table 1 columns changed: {header}'
        raise ValueError(msg)
    return [
        SpecValue(config_of(cells[0])[0], metric, printed(cell))
        for cells in body
        for metric, cell in zip(TABLE_COLUMNS, cells[1:], strict=True)
    ]


def certified_estimates(text: str) -> list[SpecValue]:
    r"""Parse Proposition 5.2's `\approx` rows: each value with the configuration attaining it."""
    values: list[SpecValue] = []
    block = section(text, r'\label{prop:certificate}', r'\end{proposition}')
    for cells in table_rows(block):
        if len(cells) != 3 or not cells[1].startswith(r'\( \approx'):  # noqa: PLR2004
            continue
        quantity = cells[0]
        if quantity not in CERTIFIED_QUANTITIES:
            msg = f'Unmapped Proposition 5.2 estimate: {quantity}'
            raise ValueError(msg)
        numbers = [printed(number) for number in re.findall(r'\d+\.\d+', cells[1])]
        configs = config_of(cells[2])
        values.extend(
            SpecValue(config, CERTIFIED_QUANTITIES[quantity], number)
            for config, number in zip(configs, numbers, strict=True)
        )
    return values


def entropy(probabilities: Distribution) -> float:
    """Return the Shannon entropy in bits, with `0 log 0 = 0`."""
    support = probabilities[probabilities > 0.0]
    return float(-np.sum(support * np.log2(support)))


def minimum_domain(bits: int) -> int:
    """Return `M^min(n) = max(2, 2^(n-1) + 1)`, the smallest pool that needs `n` qubits."""
    return max(2, (1 << (bits - 1)) + 1)


def born_law(state: State, base_bits: int, overlay_bits: int) -> Distribution:
    """Return `P(B = b, O = o)` indexed by the little-endian register values `b` and `o`.

    Each dump axis is one qubit, first allocated first; reversing the axes within each register
    makes its first qubit the least significant bit, as `MResetEachZ` decoding does.
    """
    qubits = base_bits + overlay_bits
    order = [*reversed(range(base_bits)), *reversed(range(base_bits, qubits))]
    return (
        (np.abs(state) ** 2)
        .reshape((2,) * qubits)
        .transpose(order)
        .reshape(1 << base_bits, 1 << overlay_bits)
    )


@functools.cache
def metrics(config: Config) -> dict[str, float]:
    """Compute every Table 1 and Proposition 5.2 metric from the simulated Born law."""
    base_bits, overlay_bits, steps = config
    state = simulate(circuit(base_bits, overlay_bits, steps))
    joint = born_law(state, base_bits, overlay_bits)
    base, overlay = joint.sum(axis=1), joint.sum(axis=0)
    base_entropy, overlay_entropy = entropy(base), entropy(overlay)

    def rectangle(base_end: int, overlay_end: int) -> float:
        return float(joint[:base_end, :overlay_end].sum())

    return {
        'S_2': -math.log2(purity(state, base_bits, overlay_bits)),
        'p_A^min': rectangle(minimum_domain(base_bits), minimum_domain(overlay_bits)),
        'half_quadrant': rectangle(len(base) // 2, len(overlay) // 2),
        'min_entropy': min(base_entropy / base_bits, overlay_entropy / overlay_bits),
        'ratio': float(max(base.max() / base.min(), overlay.max() / overlay.min())),
        'information': base_entropy + overlay_entropy - entropy(joint.ravel()),
        'min_probability': float(joint.min()),
        'median_effective': float(
            np.median([2.0 ** entropy(row) for row in joint / base[:, np.newaxis]])
        ),
    }


class SpecificationNumberTests(unittest.TestCase):
    """Reproduce the specification's certified numbers from the Q# state vector.

    Unitarity, complement invariance and purity below one would survive, say, reversed bit
    weights; these values pin the angles, gate order, endianness and decoding to the proved law.
    """

    text: str

    @override
    @classmethod
    def setUpClass(cls) -> None:
        """Read the specification once."""
        cls.text = SPECIFICATION.read_text(encoding='utf-8')

    def assert_printed(self, values: list[SpecValue]) -> None:
        """Each metric rounds to its printed digits: within half a unit of the last one."""
        for spec in values:
            with self.subTest(config=spec.config, metric=spec.metric):
                actual = metrics(spec.config)[spec.metric]
                self.assertLessEqual(abs(actual - spec.printed.value), 0.51 * spec.printed.unit)

    def test_table_one(self) -> None:
        """All 8 rows and 6 metrics of Table 1 (`tab:domain-profile`)."""
        values = table_one(self.text)
        self.assertEqual(len(values), 8 * len(TABLE_COLUMNS))
        self.assertIn(((9, 7, 3), 'S_2', Printed(5.4703, 1e-4)), values_key(values))
        self.assert_printed(values)

    def test_proposition_five_one_estimates(self) -> None:
        r"""Every `\approx` value of Proposition 5.2 at the configuration attaining it."""
        values = certified_estimates(self.text)
        self.assertEqual(
            {(spec.config, spec.metric) for spec in values},
            {
                ((9, 7, 5), 'p_A^min'),
                ((10, 6, 5), 'half_quadrant'),
                ((9, 7, 3), 'information'),
                ((9, 7, 6), 'information'),
                ((9, 7, 3), 'median_effective'),
            },
        )
        self.assert_printed(values)

    def test_parsers_reject_changed_or_unknown_rows(self) -> None:
        """A reordered Table 1 or a new, unmapped estimate fails instead of being skipped."""
        self.assertEqual(printed(r'1.22 \times 10^{-1}'), Printed(0.122, 0.001))
        with self.assertRaisesRegex(ValueError, 'No printed decimal'):
            printed('none')
        table = self.text.replace('Max/min ratio', 'Ratio', 1)
        with self.assertRaisesRegex(ValueError, 'Table 1 columns changed'):
            table_one(table)
        estimate = self.text.replace(r'\( \min p_A \)', r'\( \min q_A \)', 1)
        with self.assertRaisesRegex(ValueError, 'Unmapped Proposition 5.2 estimate'):
            certified_estimates(estimate)


def values_key(values: list[SpecValue]) -> set[tuple[Config, str, Printed]]:
    """Index parsed values by configuration, metric and printed number."""
    return {(spec.config, spec.metric, spec.printed) for spec in values}


def tearDownModule() -> None:
    """Free QDK contexts on this thread; PyO3 rejects dropping them on another one."""
    gc.collect()


if __name__ == '__main__':
    unittest.main()
