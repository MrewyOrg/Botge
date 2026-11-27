import BotgeQuantum.EntangleStack;
import Std.Diagnostics.Fact;

// These tests compile under Base, the profile the sidecar uses. Checks that read simulator state
// (unitarity, the Corollary 4.4 closed form, complement invariance and entanglement) would need
// `CheckAllZero`, which Base rejects, so quantum/tests/test_circuit.py makes them on the state
// vector.

/// # Summary
/// Verifies `EntangleStack` returns `(10, 6)`-qubit registers at every depth.
@Test()
operation TestEntangleStackTenSixWidths() : Unit {
    for steps in 1..6 {
        let (baseResults, overlayResults) = EntangleStack(10, 6, steps);
        Fact(Length(baseResults) == 10, "Expected 10 base results.");
        Fact(Length(overlayResults) == 6, "Expected 6 overlay results.");
    }
}

/// # Summary
/// Verifies `EntangleStack` returns `(9, 7)`-qubit registers at every depth.
@Test()
operation TestEntangleStackNineSevenWidths() : Unit {
    for steps in 1..6 {
        let (baseResults, overlayResults) = EntangleStack(9, 7, steps);
        Fact(Length(baseResults) == 9, "Expected 9 base results.");
        Fact(Length(overlayResults) == 7, "Expected 7 overlay results.");
    }
}

/// # Summary
/// Verifies `EntangleStack` widths at the smallest and most lopsided admissible registers.
@Test()
operation TestEntangleStackEdgeWidths() : Unit {
    for (baseBits, overlayBits) in [(1, 1), (1, 7), (10, 1)] {
        let (baseResults, overlayResults) = EntangleStack(baseBits, overlayBits, 3);
        Fact(Length(baseResults) == baseBits, "Expected one base result per qubit.");
        Fact(Length(overlayResults) == overlayBits, "Expected one overlay result per qubit.");
    }
}
