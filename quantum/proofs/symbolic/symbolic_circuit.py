"""Proposition 3.2: the centered register and its coupling expand into Pauli `Z` and `Rzz` gates."""

from symbolic_support import MAX_BASE_BITS, MAX_OVERLAY_BITS, MAX_QUBITS, require, sp


def verify_pauli_expansion() -> None:
    """`eq:pauli-x` for every register width up to ten qubits (SymPy)."""
    for width in range(1, MAX_BASE_BITS + 1):
        bits = sp.symbols(f'b0:{width}')
        centered = sum((1 << j) * bits[j] for j in range(width)) - sp.Rational((1 << width) - 1, 2)
        pauli = -sp.Rational(1, 2) * sum((1 << j) * (1 - 2 * bits[j]) for j in range(width))
        require(sp.expand(centered - pauli) == 0, f'eq:pauli-x fails at n = {width}')


def verify_coupling() -> None:
    """`eq:rzz-pos`: the coupling expands into `Rzz` angles at every admissible width (SymPy)."""
    scale, max_size = sp.symbols('u N', positive=True)
    widths = [
        (base_bits, overlay_bits)
        for base_bits in range(1, MAX_BASE_BITS + 1)
        for overlay_bits in range(1, MAX_OVERLAY_BITS + 1)
        if base_bits + overlay_bits <= MAX_QUBITS
    ]
    for base_bits, overlay_bits in widths:
        z_base = sp.symbols(f'Zb0:{base_bits}')
        z_overlay = sp.symbols(f'Zo0:{overlay_bits}')
        x_base = -sp.Rational(1, 2) * sum((1 << j) * z_base[j] for j in range(base_bits))
        x_overlay = -sp.Rational(1, 2) * sum((1 << k) * z_overlay[k] for k in range(overlay_bits))
        coupling = -(2 * scale / max_size) * x_base * x_overlay
        gates = sp.Rational(1, 2) * sum(
            -(scale * (1 << j) * (1 << k) / max_size) * z_base[j] * z_overlay[k]
            for j in range(base_bits)
            for k in range(overlay_bits)
        )
        require(sp.expand(coupling - gates) == 0, f'eq:rzz-pos fails at {base_bits, overlay_bits}')
    print('Proposition 3.2 (SymPy): passed')
