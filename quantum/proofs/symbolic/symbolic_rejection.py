"""Theorem 5.1: rejection-sampling partial sums, their limits and the acceptance floor."""

from symbolic_support import is_zero, require, sp, z3


def verify_rejection() -> None:
    """Geometric partial sums, their limits, and the three-case acceptance floor (SymPy, Z3)."""
    p, mass = sp.symbols('p P', positive=True)
    k = sp.symbols('k', integer=True, nonnegative=True)
    trials = sp.Symbol('K', integer=True, positive=True)
    expected = sp.summation((1 - p) ** k, (k, 0, trials - 1))
    require(is_zero(expected - (1 - (1 - p) ** trials) / p), 'E[tau] partial sum')
    conditional = mass * sp.summation((1 - p) ** (k - 1), (k, 1, trials))
    require(is_zero(conditional - mass * (1 - (1 - p) ** trials) / p), 'conditional partial sum')
    ratio = sp.Symbol('q', positive=True)
    accepted = 1 / (1 + ratio)
    require(sp.limit(expected.subs(p, accepted), trials, sp.oo) == 1 / accepted, 'E[tau] limit')
    limit = sp.limit(conditional.subs(p, accepted), trials, sp.oo)
    require(is_zero(limit - mass / accepted), 'conditional law limit')
    require(acceptance_floor_holds(), 'Theorem 5.1 floor has a counterexample')
    print('Theorem 5.1 (SymPy, Z3): passed')


def acceptance_floor_holds(wide_floor_divisor: int = 4) -> bool:
    """Whether every case of the acceptance floor gives `p_A > 1/4` and `E[τ] < 4`.

    The per-case floors are hypotheses here: Theorem 5.1 derives them, and the
    `botge-quantum-certificate` crate encloses `p_A` on all 414 admissible configurations.

    `wide_floor_divisor` is the `4` in the wide-register floor `p_A ≥ (1 + c) / 4`.
    """
    base_bits, overlay_bits = z3.Ints('nb no')
    correlation, acceptance = z3.Reals('c p')
    solver = z3.Solver()
    solver.add(base_bits >= 1, overlay_bits >= 1, correlation > 0, correlation <= 1)
    one_qubit = z3.And(base_bits == 1, overlay_bits == 1, acceptance == 1)
    mixed = z3.And(
        z3.Or(z3.And(base_bits == 1, overlay_bits >= 2), z3.And(overlay_bits == 1, base_bits >= 2)),  # noqa: PLR2004
        acceptance >= z3.Q(1, 2),
    )
    wide_floor = (1 + correlation) / wide_floor_divisor
    wide = z3.And(base_bits >= 2, overlay_bits >= 2, acceptance >= wide_floor)  # noqa: PLR2004
    solver.add(z3.Or(one_qubit, mixed, wide))
    floor = (1 + correlation) / 4
    solver.add(z3.Not(z3.And(acceptance >= floor, floor > z3.Q(1, 4), 1 / acceptance < 4)))  # noqa: PLR2004
    return bool(solver.check() == z3.unsat)
