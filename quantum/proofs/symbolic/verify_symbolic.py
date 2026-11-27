"""Symbolic (SymPy) and SMT (Z3) checks of quantum/docs/botge-quantum.tex.

These checks complement the Lean formalization in `quantum/proofs/lean/`: they recompute
identities with an independent computer-algebra system and decide the finite integer and real
claims with an SMT solver. Each `symbolic_*` module covers one section of the specification, and
each check raises `SystemExit` with a message on the first failure.
"""

from symbolic_budget import verify_budget
from symbolic_circuit import verify_coupling, verify_pauli_expansion
from symbolic_correlations import (
    verify_heisenberg,
    verify_intra_angles,
    verify_morrie,
    verify_optimal_readout,
    verify_two_by_two_register,
)
from symbolic_entanglement import verify_entanglement
from symbolic_rejection import verify_rejection
from symbolic_two_by_two import verify_two_by_two_closed_form, verify_two_by_two_numbers


def main() -> None:
    """Run every symbolic and SMT check in specification order."""
    verify_budget()
    verify_pauli_expansion()
    verify_coupling()
    verify_entanglement()
    verify_heisenberg()
    verify_optimal_readout()
    verify_morrie()
    verify_two_by_two_register()
    verify_intra_angles()
    verify_two_by_two_closed_form()
    verify_two_by_two_numbers()
    verify_rejection()
    print('All SymPy and Z3 checks passed.')


if __name__ == '__main__':
    main()
