import Std.Arrays.IndexRange;
import Std.Canon.ApplyToEachCA;
import Std.Convert.IntAsDouble;
import Std.Diagnostics.Fact;
import Std.Math.MaxI;
import Std.Math.PI;
import Std.Math.Sqrt;
import Std.Measurement.MResetEachZ;

export ApplyIsingRxCircuit, EntangleStack;

/// # Summary
/// Applies the bipartite position coupling `exp(-i V_L)` as commuting `Rzz` gates
/// (`prop:compile`, `eq:rzz-pos`).
///
/// # Input
/// ## baseReg
/// Little-endian base register `B` with `n_b` qubits.
/// ## overlayReg
/// Little-endian overlay register `O` with `n_o` qubits.
/// ## steps
/// Entanglement depth `L`.
///
/// # Remarks
/// Each pair `(j, l)` receives `Rzz(theta_jl)` with
/// `theta_jl = -u_L 2^j 2^l / max(N_b, N_o) < 0` and `u_L = phi^-1 sqrt(L)`, so the coupling
/// uses `n_b n_o` pairwise-commuting gates with no global phase.
operation ApplyPositionCoupling(
    baseReg : Qubit[],
    overlayReg : Qubit[],
    steps : Int
) : Unit is Adj + Ctl {
    let goldenInverse = 0.5 * Sqrt(5.0) - 0.5;
    let coupling = goldenInverse * Sqrt(IntAsDouble(steps));
    let largest = IntAsDouble(MaxI(1 <<< Length(baseReg), 1 <<< Length(overlayReg)));
    for j in IndexRange(baseReg) {
        for l in IndexRange(overlayReg) {
            let weight = IntAsDouble(1 <<< j) * IntAsDouble(1 <<< l);
            let theta = -coupling * weight / largest;
            Rzz(theta, baseReg[j], overlayReg[l]);
        }
    }
}

/// # Summary
/// Fails unless the register widths and depth lie in the admissible domain (`prop:budget`).
///
/// # Input
/// ## baseBits
/// Base register width `n_b` (1..10).
/// ## overlayBits
/// Overlay register width `n_o` (1..7), with `n_b + n_o <= 16`.
/// ## steps
/// Entanglement depth `L` (1..6).
function CheckDomain(baseBits : Int, overlayBits : Int, steps : Int) : Unit {
    Fact(baseBits >= 1 and baseBits <= 10, "baseBits must be in 1..10.");
    Fact(overlayBits >= 1 and overlayBits <= 7, "overlayBits must be in 1..7.");
    Fact(baseBits + overlayBits <= 16, "Total qubit width must not exceed 16.");
    Fact(steps >= 1 and steps <= 6, "steps must be in 1..6.");
}

/// # Summary
/// Prepares the Ising-Rx state `|psi_L> = U_L |0...0>` without measurement (`def:ising-rx`).
///
/// # Input
/// ## baseReg
/// Little-endian base register `B` (1..10 qubits).
/// ## overlayReg
/// Little-endian overlay register `O` (1..7 qubits).
/// ## steps
/// Entanglement depth `L` (1..6).
///
/// # Remarks
/// `U_L = (R_X^n_b (x) R_X^n_o) exp(-i V_L) (H^n_b (x) H^n_o)` with `R_X = Rx(-pi / 4)`, in
/// `n_b n_o + 2 (n_b + n_o) <= 96` gates. Exposed as an `Adj + Ctl` unitary for testing.
operation ApplyIsingRxCircuit(
    baseReg : Qubit[],
    overlayReg : Qubit[],
    steps : Int
) : Unit is Adj + Ctl {
    let baseBits = Length(baseReg);
    let overlayBits = Length(overlayReg);
    CheckDomain(baseBits, overlayBits, steps);

    ApplyToEachCA(H, baseReg + overlayReg);
    ApplyPositionCoupling(baseReg, overlayReg, steps);
    ApplyToEachCA(Rx(-PI() / 4.0, _), baseReg + overlayReg);
}

/// # Summary
/// Samples one base and overlay index pair from the Ising-Rx state, then resets every qubit.
///
/// # Input
/// ## baseBits
/// Base register width `n_b` (1..10).
/// ## overlayBits
/// Overlay register width `n_o` (1..7).
/// ## steps
/// Entanglement depth `L` (1..6).
///
/// # Output
/// The measured base and overlay registers, least significant bit first.
///
/// # Remarks
/// Runs under `TargetProfile.Base`: no mid-circuit branching, and the caller decodes the
/// results and performs rejection sampling (`thm:rejection`).
operation EntangleStack(baseBits : Int, overlayBits : Int, steps : Int) : (Result[], Result[]) {
    CheckDomain(baseBits, overlayBits, steps);

    use baseReg = Qubit[baseBits];
    use overlayReg = Qubit[overlayBits];
    ApplyIsingRxCircuit(baseReg, overlayReg, steps);
    return (MResetEachZ(baseReg), MResetEachZ(overlayReg));
}
