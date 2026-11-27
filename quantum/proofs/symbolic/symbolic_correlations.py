"""Theorem 4.3: Heisenberg-picture correlations, the optimal readout and the `(2, 2)` register."""

from symbolic_support import MAX_BASE_BITS, Dynamic, is_zero, pauli, require, sp, z3

STATES_2X2 = 16


def verify_heisenberg() -> None:
    """`eq:heis-rx`, `eq:heis-vl` and the two-qubit flip symmetries (SymPy)."""
    identity, x, y, z = pauli()
    phi, theta = sp.symbols('phi theta', real=True)
    rx = sp.cos(phi / 2) * identity - sp.I * sp.sin(phi / 2) * x
    require(
        sp.simplify(rx.H * z * rx - (sp.cos(phi) * z + sp.sin(phi) * y)) == sp.zeros(2, 2),
        'eq:heis-rx fails',
    )
    forward = sp.cos(theta / 2) * identity + sp.I * sp.sin(theta / 2) * z
    backward = sp.cos(theta / 2) * identity - sp.I * sp.sin(theta / 2) * z
    require(
        sp.simplify(forward * y * backward - (sp.cos(theta) * y + sp.sin(theta) * x))
        == sp.zeros(2, 2),
        'eq:heis-vl fails',
    )
    xx, yy, zz = (sp.kronecker_product(m, m) for m in (x, y, z))
    require(xx * zz * xx == zz, 'X⊗X does not commute with Z⊗Z')
    require(zz * yy == yy * zz, 'Z⊗Z does not commute with Y⊗Y')


def verify_optimal_readout() -> None:
    """Part (2): `-sin 2φ` peaks at `φ = -π/4` on `[-π/2, π/2]` (SymPy)."""
    phi = sp.symbols('phi', real=True)
    prefactor = -sp.sin(2 * phi)
    slope = sp.diff(prefactor, phi)
    critical = sp.solveset(sp.Eq(slope, 0), phi, sp.Interval(-sp.pi / 2, sp.pi / 2))
    require(critical == sp.FiniteSet(-sp.pi / 4, sp.pi / 4), 'unexpected critical points')
    require(prefactor.subs(phi, -sp.pi / 4) == 1, 'maximum is not 1')
    require(sp.diff(slope, phi).subs(phi, -sp.pi / 4) < 0, 'not a maximum')
    require(prefactor.subs(phi, sp.pi / 4) == -1, 'minimum is not -1')
    for endpoint in (-sp.pi / 2, sp.pi / 2):
        require(prefactor.subs(phi, endpoint) == 0, 'endpoint is not 0')


def verify_morrie() -> None:
    """Morrie's identity: symbolically for `m < 5`, by polynomial telescoping up to `m = 10`."""
    x = sp.symbols('x', real=True)
    a, b = sp.symbols('A B', real=True)
    require(is_zero(2 * sp.sin(a) * sp.sin(b) - (sp.cos(a - b) - sp.cos(a + b))), 'product-to-sum')
    z = sp.Symbol('z')
    for m in range(MAX_BASE_BITS + 1):
        if m < 5:  # noqa: PLR2004 - symbolic simplification stays fast below five factors
            product = sp.prod([sp.cos(2**k * x) for k in range(m)])
            require(is_zero(product * 2**m * sp.sin(x) - sp.sin(2**m * x)), f'Morrie m = {m}')
        telescoped = sp.Poly(z**2 - 1, z, domain='ZZ')
        for k in range(m):
            telescoped *= sp.Poly(z ** (2 ** (k + 1)) + 1, z, domain='ZZ')
        require(telescoped == sp.Poly(z ** (2 ** (m + 1)) - 1, z, domain='ZZ'), f'telescope {m}')


def two_by_two_probabilities() -> tuple[list[Dynamic], Dynamic, Dynamic]:
    """Scaled Born polynomials of the `(n_b, n_o) = (2, 2)` circuit in `Z[w, s]`.

    `w = e^{i u_L / 8}` and `s = e^{iφ}`, so every amplitude is an integer polynomial.
    """
    w, s = sp.symbols('w s')
    amplitudes = [sp.Poly(0, w, s, domain='ZZ')] * STATES_2X2
    for base in range(4):
        for overlay in range(4):
            amplitudes[base + 4 * overlay] = sp.Poly(
                w ** ((2 * base - 3) * (2 * overlay - 3) + 9), w, s, domain='ZZ'
            )
    keep = sp.Poly(1 + s, w, s, domain='ZZ')
    swap = sp.Poly(1 - s, w, s, domain='ZZ')
    for qubit in range(4):
        step = 1 << qubit
        for start in range(0, STATES_2X2, step << 1):
            for low in range(start, start + step):
                zero, one = amplitudes[low], amplitudes[low + step]
                amplitudes[low] = keep * zero + swap * one
                amplitudes[low + step] = swap * zero + keep * one

    def conjugate(poly: Dynamic) -> Dynamic:
        terms = {(18 - ew, 4 - es): coeff for (ew, es), coeff in poly.terms()}
        return sp.Poly.from_dict(terms, w, s, domain='ZZ')

    return [amp * conjugate(amp) for amp in amplitudes], w, s


def signed_sum(probabilities: list[Dynamic], mask: int, w: Dynamic, s: Dynamic) -> Dynamic:
    """`∑_x (-1)^{|x ∧ mask|} P(x)`, the expectation of a Pauli-`Z` product."""
    total = sp.Poly(0, w, s, domain='ZZ')
    for index, probability in enumerate(probabilities):
        total += -probability if (index & mask).bit_count() % 2 else probability
    return total


def verify_two_by_two_register() -> None:
    """Check the full `(2, 2)` register: normalization, odd moments and `eq:bitwise-corr`."""
    probabilities, w, s = two_by_two_probabilities()
    zero = sp.Poly(0, w, s, domain='ZZ')
    require(sum(probabilities, zero) == sp.Poly(4096 * w**18 * s**4, w, s, domain='ZZ'), 'norm')
    for mask in range(1, STATES_2X2):
        if mask.bit_count() % 2:
            require(signed_sum(probabilities, mask, w, s) == zero, f'odd moment {mask}')
    for j in range(2):
        for k in range(2):
            couple = 2 * (1 << j) * (1 << k)
            base = 2 * (1 << (1 - j)) * (1 << k)
            overlay = 2 * (1 << j) * (1 << (1 - k))
            expected = sp.Poly(
                256
                * s**2
                * (s**4 - 1)
                * (w ** (2 * couple) - 1)
                * (
                    w ** (18 - couple - base) * (w ** (2 * base) + 1)
                    + w ** (18 - couple - overlay) * (w ** (2 * overlay) + 1)
                ),
                w,
                s,
                domain='ZZ',
            )
            mask = (1 << j) | (1 << (2 + k))
            require(signed_sum(probabilities, mask, w, s) == expected, f'eq:bitwise-corr {j}{k}')
    for mask in ((1 << 0) | (1 << 1), (1 << 2) | (1 << 3)):
        verify_intra_register(signed_sum(probabilities, mask, w, s), w)


def verify_intra_register(signed: Dynamic, w: Dynamic) -> None:
    """`eq:intra-corr` at `φ = -π/4` (`s² = -i`, `s⁴ = -1`) for one `(2, 2)` register pair."""
    coefficients: dict[int, Dynamic] = {}
    # The Born polynomials carry a `w^18 s^4` factor; dividing by `s^4 = -1` negates each term.
    for (ew, es), coeff in signed.terms():
        require(es % 2 == 0, 'odd power of s in an intra-register moment')
        coefficients[ew] = coefficients.get(ew, sp.Integer(0)) - coeff * (-sp.I) ** (es // 2)
    require(all(sp.im(value) == 0 for value in coefficients.values()), 'complex moment')
    reduced = sp.Poly.from_dict(
        {(ew,): int(sp.re(value)) for ew, value in coefficients.items() if value != 0},
        w,
        domain='ZZ',
    )
    expected = sp.Poly(
        256 * (w**12 * (w**16 - 1) * (w**12 - 1) - (w**48 - 1) * (w**4 - 1)), w, domain='ZZ'
    )
    require(reduced * sp.Poly((w**4 - 1) * (w**12 - 1), w, domain='ZZ') == expected, 'intra')


def verify_intra_angles() -> None:
    """Part (2): intra-register angles lie in `(0, 3π/8)` (Z3)."""
    size, max_size, distance, scale, pi = z3.Reals('N M d u pi')
    solver = z3.Solver()
    solver.add(pi > 3, size >= 2, max_size >= size, distance >= 1, distance <= 3 * size / 4)  # noqa: PLR2004
    solver.add(scale > 0, scale < pi / 2)
    angle = scale * distance / max_size
    solver.add(z3.Not(z3.And(angle > 0, angle < 3 * pi / 8)))
    require(solver.check() == z3.unsat, 'intra-register angle leaves (0, 3π/8)')
    print('Theorem 4.3 (SymPy, Z3): passed')
