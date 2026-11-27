"""Theorem 4.1: Dirichlet kernel, triangular normalization and the coupling-scale bounds."""

from symbolic_support import DIGITS, is_zero, require, sp


def verify_entanglement() -> None:
    """Dirichlet sum, triangular identity, trigonometric steps and bounds (SymPy)."""
    verify_dirichlet_sum()
    scale, delta = sp.symbols('u Delta', real=True, positive=True)
    for size in (2, 4, 8):
        grid = [sp.Rational(2 * x - (size - 1), 2) for x in range(size)]
        dirichlet = sp.Rational(1, size) * sum(
            sp.exp(sp.I * 2 * scale / size * delta * x) for x in grid
        )
        kernel = sp.sin(scale * delta) / (size * sp.sin(scale * delta / size))
        require(is_zero(sp.trigsimp(dirichlet.rewrite(sp.cos)) - kernel), 'Dirichlet sum fails')
    size, distance = sp.symbols('N d', integer=True, positive=True)
    triangle = 1 / size + 2 / size**2 * sp.summation(size - distance, (distance, 1, size - 1))
    require(is_zero(triangle - 1), 'triangular normalization fails')
    require(is_zero(sp.sin(scale) / (2 * sp.sin(scale / 2)) - sp.cos(scale / 2)), 'half angle')
    phi_inverse = (sp.sqrt(5) - 1) / 2
    first, sixth = phi_inverse, phi_inverse * sp.sqrt(6)
    require(sp.Rational('0.6180') < first.evalf(DIGITS) < sp.Rational('0.6181'), 'u_1 bound')
    require(sp.Rational('1.5138') < sixth.evalf(DIGITS) < sp.Rational('1.5139'), 'u_6 bound')
    require(sixth.evalf(DIGITS) < (sp.pi / 2).evalf(DIGITS), 'u_6 < pi/2')
    require((sp.sin(sixth) / sixth).evalf(DIGITS) > sp.Rational('0.659'), 'sin(u)/u bound')
    require(sp.cos(first / 2).evalf(DIGITS) < sp.Rational('0.953'), 'cos bound')
    print('Theorem 4.1 (SymPy): passed')


def verify_dirichlet_sum() -> None:
    """Check that the centered geometric sum is the Dirichlet kernel for every size `N`.

    With `t = e^{ic}`, `∑_x t^{2x - (N - 1)} (t - t⁻¹) = t^N - t^{-N}`, which is
    `sin(Nc) / sin c` after dividing by `2i sin c`; `c = u Δ / N` gives the kernel above.
    """
    t = sp.Symbol('t', positive=True)
    size, x = sp.symbols('N x', integer=True, positive=True)
    geometric = sp.summation(t ** (2 * x - (size - 1)), (x, 0, size - 1))
    # SymPy splits off `t² = 1`, that is `c ∈ πZ`, where the kernel stands for its limit.
    cases = list(geometric.atoms(sp.Piecewise))
    require(len(cases) == 1 and cases[0].args[-1][1] is sp.true, 'unexpected geometric sum cases')
    general = geometric.subs(cases[0], cases[0].args[-1][0])
    telescoped = general * (t - 1 / t) - (t**size - t ** (-size))
    require(is_zero(sp.powsimp(sp.expand(telescoped), force=True)), 'Dirichlet sum for every N')
