"""Shared SymPy and Z3 handles, register limits and failure reporting for the symbolic checks."""

import importlib
from typing import Any

__all__ = [
    'DIGITS',
    'MAX_BASE_BITS',
    'MAX_OVERLAY_BITS',
    'MAX_QUBITS',
    'Dynamic',
    'is_zero',
    'pauli',
    'require',
    'sp',
    'z3',
]

# SymPy and Z3 ship without type information; their expressions are dynamically typed here.
Dynamic = Any

sp: Dynamic = importlib.import_module('sympy')
z3: Dynamic = importlib.import_module('z3')

MAX_BASE_BITS = 10
MAX_OVERLAY_BITS = 7
MAX_QUBITS = 16
DIGITS = 50


def require(condition: object, message: str) -> None:
    """Fail the verification run with `message` unless `condition` holds."""
    if not bool(condition):
        raise SystemExit(message)


def is_zero(expression: Dynamic) -> bool:
    """Whether a SymPy expression simplifies to zero."""
    return bool(sp.simplify(expression) == 0)


def pauli() -> tuple[Dynamic, Dynamic, Dynamic, Dynamic]:
    """Return the identity and the Pauli `X`, `Y`, `Z` matrices."""
    return (
        sp.eye(2),
        sp.Matrix([[0, 1], [1, 0]]),
        sp.Matrix([[0, -sp.I], [sp.I, 0]]),
        sp.Matrix([[1, 0], [0, -1]]),
    )
