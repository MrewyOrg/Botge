"""Corollary 4.4: the exact `2 x 2` state, its Born law, spectrum and printed values."""

import itertools

from symbolic_support import DIGITS, Dynamic, is_zero, pauli, require, sp


def verify_two_by_two_closed_form() -> None:
    """Check the `2 x 2` state and `e^{iπ/4}` phase, its Born law, and `rho_B` and its spectrum."""
    e8, cos_t, sin_t = sp.symbols('e8 cos_t sin_t')
    cyclotomic = sp.Poly(e8**8 + 1, e8, cos_t, sin_t, domain='QQ')
    inverse, imaginary = -(e8**7), e8**4
    root_half = (e8**2 - e8**6) / 2
    rx = sp.Matrix([[e8 + inverse, e8 - inverse], [e8 - inverse, e8 + inverse]]) / 2
    rzz = cos_t * sp.eye(4) + imaginary * sin_t * sp.Matrix.diag(1, -1, -1, 1)
    state = sp.kronecker_product(rx, rx) * rzz * sp.Matrix([1, 1, 1, 1]) / 2
    plus, minus = sp.Matrix([1, 1]) * root_half, sp.Matrix([1, -1]) * root_half
    closed = e8**2 * (
        cos_t * sp.kronecker_product(plus, plus) + sin_t * sp.kronecker_product(minus, minus)
    )
    for index in range(4):
        residue = sp.Poly(state[index] - closed[index], e8, cos_t, sin_t, domain='QQ')
        require(residue.rem(cyclotomic).is_zero, f'eq:two-by-two-state index {index}')
    theta = sp.symbols('theta', real=True)
    eighth = sp.exp(sp.I * sp.pi / 8)
    phased = closed.subs({e8: eighth, cos_t: sp.cos(theta / 2), sin_t: sp.sin(theta / 2)})
    signs = (1, -1, -1, 1)
    for index, sign in enumerate(signs):
        born = phased[index] * sp.conjugate(phased[index])
        require(is_zero(born - (1 + sign * sp.sin(theta)) / 4), f'Born probability {index}')
    # Trace out the overlay qubit, the second Kronecker factor.
    reduced = sp.Matrix(
        [
            [
                sum(
                    phased[2 * row + overlay] * sp.conjugate(phased[2 * column + overlay])
                    for overlay in range(2)
                )
                for column in range(2)
            ]
            for row in range(2)
        ]
    )
    _, x, _, _ = pauli()
    require(sp.simplify(reduced - (sp.eye(2) + sp.cos(theta) * x) / 2) == sp.zeros(2, 2), 'rho_B')
    for vector, value in ((sp.Matrix([1, 1]), 1), (sp.Matrix([1, -1]), -1)):
        eigen = reduced * vector - (1 + value * sp.cos(theta)) / 2 * vector
        require(sp.simplify(eigen) == sp.zeros(2, 1), 'rho_B eigenpair')


def theta(depth: int) -> Dynamic:
    """`ϑ_L = u_L / 2 = φ⁻¹ √L / 2` for the `(1, 1)` register."""
    return (sp.sqrt(5) - 1) / 2 * sp.sqrt(depth) / 2


def printed_values() -> tuple[tuple[Dynamic, str], ...]:
    """Pair each value Corollary 4.4 prints with its exact `sin ϑ_L`, `S(rho_B)` or `I(B; O)`.

    `sin ϑ_L ∈ [0.304, 0.687]` prints the `L = 1` and `L = 6` endpoints to three decimals.
    """

    def binary_entropy(p: Dynamic) -> Dynamic:
        return -p * sp.log(p, 2) - (1 - p) * sp.log(1 - p, 2)

    return (
        (sp.sin(theta(1)), '0.304'),
        (binary_entropy((1 + sp.cos(theta(3))) / 2), '0.3656'),
        (1 - binary_entropy((1 + sp.sin(theta(3))) / 2), '0.1968'),
        (sp.sin(theta(6)), '0.687'),
        (1 - binary_entropy((1 + sp.sin(theta(6))) / 2), '0.3738'),
    )


def verify_two_by_two_numbers(
    checks: tuple[tuple[Dynamic, str], ...] | None = None,
) -> None:
    """Check that each printed value is its 50-digit evaluation rounded to the printed digits.

    Also check that `sin ϑ_L` increases strictly with the depth, as Corollary 4.4 states.
    """
    for expression, printed in checks or printed_values():
        half_unit = sp.Rational(1, 2 * 10 ** len(printed.partition('.')[2]))
        error = abs(expression - sp.Rational(printed)).evalf(DIGITS)
        require(error < half_unit, f'Corollary 4.4 value {expression.evalf(8)} is not {printed}')
    sines = [sp.sin(theta(depth)).evalf(DIGITS) for depth in range(1, 7)]
    require(all(a < b for a, b in itertools.pairwise(sines)), 'sin ϑ_L not increasing')
    print('Corollary 4.4 (SymPy): passed')
