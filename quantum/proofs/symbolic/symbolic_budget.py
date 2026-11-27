"""Proposition 2.1: the piecewise pool caps keep every circuit within sixteen qubits (Z3)."""

from symbolic_support import MAX_BASE_BITS, MAX_OVERLAY_BITS, MAX_QUBITS, Dynamic, require, z3

NARROW_BASE_LIMIT = 512
# Pool caps (M_b^max, M_o^max) of eq:pool-cap.
NARROW_CAPS = (512, 128)
WIDE_CAPS = (1024, 64)
# Widths searched for `⌈log₂ pool⌉`, well past every limit so that a register that grows too wide
# is a counterexample rather than a pool the encoding cannot describe.
SEARCH_BITS = 2 * MAX_QUBITS


def ceil_log2_constraint(pool: Dynamic, bits: Dynamic) -> Dynamic:
    """Z3 constraint `bits = ⌈log₂ pool⌉`, that is `2^(bits-1) < pool ≤ 2^bits`, for `bits ≥ 1`."""
    return z3.Or(
        *[
            z3.And(bits == k, (1 << (k - 1)) < pool, pool <= 1 << k)
            for k in range(1, SEARCH_BITS + 1)
        ]
    )


def has_width(pool: Dynamic) -> Dynamic:
    """Z3 constraint that some searched width satisfies `2^(k-1) < pool ≤ 2^k`."""
    return z3.Or(
        *[z3.And((1 << (k - 1)) < pool, pool <= 1 << k) for k in range(1, SEARCH_BITS + 1)]
    )


def power_of_two(bits: Dynamic, size: Dynamic) -> Dynamic:
    """Z3 constraint `size = 2^bits` for `bits ∈ 1..SEARCH_BITS`."""
    return z3.Or(*[z3.And(bits == k, size == 1 << k) for k in range(1, SEARCH_BITS + 1)])


def budget_holds(
    narrow_caps: tuple[int, int] = NARROW_CAPS, wide_caps: tuple[int, int] = WIDE_CAPS
) -> bool:
    """Whether the register claims of Proposition 2.1 hold for every pool size `C_b, C_o ≥ 2`.

    A counterexample is a pool whose width the search cannot express, or widths that break a
    claim: each register within its qubit limit and cap, the total within sixteen qubits, and each
    register more than half full.
    """
    base_count, overlay_count = z3.Ints('base_count overlay_count')
    narrow = base_count <= NARROW_BASE_LIMIT
    base_cap = z3.If(narrow, narrow_caps[0], wide_caps[0])
    base_pool = z3.If(base_count < base_cap, base_count, base_cap)
    overlay_cap = z3.If(narrow, narrow_caps[1], wide_caps[1])
    overlay_pool = z3.If(overlay_count < overlay_cap, overlay_count, overlay_cap)
    base_bits, overlay_bits, base_size, overlay_size = z3.Ints('nb no Nb No')
    widths = z3.And(
        ceil_log2_constraint(base_pool, base_bits),
        ceil_log2_constraint(overlay_pool, overlay_bits),
        power_of_two(base_bits, base_size),
        power_of_two(overlay_bits, overlay_size),
    )
    claim = z3.And(
        base_bits <= MAX_BASE_BITS,
        overlay_bits <= MAX_OVERLAY_BITS,
        base_bits + overlay_bits <= MAX_QUBITS,
        base_size <= base_cap,
        overlay_size <= overlay_cap,
        base_size / 2 < base_pool,
        overlay_size / 2 < overlay_pool,
        z3.Implies(base_bits == 1, base_pool == 2),  # noqa: PLR2004 - exact occupancy
        z3.Implies(overlay_bits == 1, overlay_pool == 2),  # noqa: PLR2004 - exact occupancy
    )
    solver = z3.Solver()
    solver.add(base_count >= 2, overlay_count >= 2)  # noqa: PLR2004 - minimum pool size
    unexpressible = z3.Not(z3.And(has_width(base_pool), has_width(overlay_pool)))
    solver.add(z3.Or(unexpressible, z3.And(widths, z3.Not(claim))))
    return bool(solver.check() == z3.unsat)


def verify_budget() -> None:
    """Proposition 2.1 for every integer domain size, and the 3.0 MiB statevector size."""
    require(budget_holds(), 'Proposition 2.1 has a counterexample')
    require((1 << MAX_QUBITS) * 48 == 3 * 1024 * 1024, '16-qubit statevector is not 3.0 MiB')
    print('Proposition 2.1 (Z3): passed')
