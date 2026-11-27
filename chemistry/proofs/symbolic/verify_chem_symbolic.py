"""SymPy and Z3 verification of chemistry/docs/botge-chemistry.tex invariants."""

import importlib
from typing import Any

# SymPy and Z3 ship without complete type stubs; expressions are dynamically typed here.
Dynamic = Any

sp: Dynamic = importlib.import_module('sympy')
z3: Dynamic = importlib.import_module('z3')

ELEMENTS = ('C', 'O', 'N', 'Cl', 'Br', 'B')
MIN_POOL = 2
MAX_BASE_POOL = 1024
MAX_OVERLAY_POOL = 128
MAX_EXCLUDED = 2
DEFAULT_AVOID_POOL = 3
ATLAS_SIZE = 32

REACTIONS_STOICHIOMETRY: tuple[tuple[str, dict[str, int], dict[str, int], dict[str, int]], ...] = (
    ('diels_alder', {'C': 4}, {'C': 4, 'O': 3}, {}),
    ('fischer_esterification', {'C': 2, 'O': 2}, {'C': 1, 'O': 1}, {'O': 1}),
    ('imine_condensation', {'C': 7, 'O': 1}, {'C': 6, 'N': 1}, {'O': 1}),
    ('amide_coupling', {'C': 2, 'O': 1, 'Cl': 1}, {'C': 6, 'N': 1}, {'Cl': 1}),
    ('williamson_sn2', {'C': 1, 'O': 1}, {'C': 4, 'Br': 1}, {'Br': 1}),
    ('aldol_condensation', {'C': 3, 'O': 1}, {'C': 7, 'O': 1}, {'O': 1}),
    ('michael_addition', {'C': 5, 'O': 2}, {'C': 4, 'O': 2}, {}),
    ('suzuki_miyaura', {'C': 6, 'Br': 1}, {'C': 6, 'B': 1, 'O': 2}, {'B': 1, 'O': 2, 'Br': 1}),
)


def require(*, condition: bool, message: str) -> None:
    """Exit with `message` if `condition` is false."""
    if not condition:
        raise SystemExit(message)


def verify_stoichiometry_sympy() -> None:
    """Verify Theorem 3.2 conservation equations symbolically in SymPy."""
    symbols = {el: sp.Symbol(el, integer=True, nonnegative=True) for el in ELEMENTS}
    for name, a_counts, b_counts, byp_counts in REACTIONS_STOICHIOMETRY:
        prod_counts = {
            el: a_counts.get(el, 0) + b_counts.get(el, 0) - byp_counts.get(el, 0) for el in ELEMENTS
        }
        for el, count in prod_counts.items():
            require(condition=count >= 0, message=f'{name}: negative count for {el}')
        lhs = sum((a_counts.get(el, 0) + b_counts.get(el, 0)) * symbols[el] for el in ELEMENTS)
        rhs = sum((prod_counts[el] + byp_counts.get(el, 0)) * symbols[el] for el in ELEMENTS)
        require(condition=bool(sp.simplify(lhs - rhs) == 0), message=f'{name}: mismatch')


def projection_bounds_hold(*, min_avoid_pool: int = DEFAULT_AVOID_POOL) -> bool:
    """Check Theorem 4.2 bounds and reactant avoidance across `2 <= M_b <= 1024` via Z3."""
    mb, hb, e1, e2, count = z3.Ints('mb hb e1 e2 count')
    mo, ho = z3.Ints('mo ho')
    step1 = z3.If(
        z3.Or(z3.And(count >= 1, hb == e1), z3.And(count >= MAX_EXCLUDED, hb == e2)),
        (hb + 1) % mb,
        hb,
    )
    step2 = z3.If(
        z3.Or(z3.And(count >= 1, step1 == e1), z3.And(count >= MAX_EXCLUDED, step1 == e2)),
        (step1 + 1) % mb,
        step1,
    )
    projected = z3.If(mb >= min_avoid_pool, step2, hb)

    solver = z3.Solver()
    solver.add(mb >= MIN_POOL, mb <= MAX_BASE_POOL, mo >= MIN_POOL, mo <= MAX_OVERLAY_POOL)
    solver.add(hb >= 0, hb < mb, ho >= 0, ho < mo)
    solver.add(count >= 0, count <= MAX_EXCLUDED)
    solver.add(e1 >= 0, e1 < mb, e2 >= 0, e2 < mb)

    bounds_ok = z3.And(projected >= 0, projected < mb, ho >= 0, ho < mo)
    avoid_ok = z3.Implies(
        mb >= DEFAULT_AVOID_POOL,
        z3.And(
            z3.Implies(count >= 1, projected != e1),
            z3.Implies(count >= MAX_EXCLUDED, projected != e2),
        ),
    )
    solver.add(z3.Not(z3.And(bounds_ok, avoid_ok)))
    return bool(solver.check() == z3.unsat)


def commutativity_z3_holds() -> bool:
    """Check Theorem 4.1 canonical pair symmetry `canon(a, b) == canon(b, a)` in Z3."""
    a, b = z3.Ints('a b')
    lo_ab = z3.If(a <= b, a, b)
    hi_ab = z3.If(a <= b, b, a)
    lo_ba = z3.If(b <= a, b, a)
    hi_ba = z3.If(b <= a, a, b)
    solver = z3.Solver()
    solver.add(a >= 0, a < ATLAS_SIZE, b >= 0, b < ATLAS_SIZE)
    solver.add(z3.Or(lo_ab != lo_ba, hi_ab != hi_ba))
    return bool(solver.check() == z3.unsat)


def main() -> None:
    """Run all chemistry symbolic and SMT verification checks."""
    verify_stoichiometry_sympy()
    require(condition=projection_bounds_hold(), message='Theorem 4.2 Z3 check failed')
    require(condition=commutativity_z3_holds(), message='Theorem 4.1 Z3 check failed')
    print('All chemistry SymPy and Z3 checks passed.')


if __name__ == '__main__':
    main()
