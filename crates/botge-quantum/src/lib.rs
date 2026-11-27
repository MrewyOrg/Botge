//! Rules and the sidecar client behind Botge's `/quantum-emote` command.
//!
//! The pure modules follow `quantum/docs/botge-quantum.tex`. [`Budget`] implements Proposition 2.1:
//! it caps the base and overlay emote pools so that the circuit never exceeds sixteen qubits.
//! [`Pools`] orders a catalog deterministically and slices those capped prefixes, [`Plan`] turns
//! them into an [`EntangleRequest`] and checks the measured [`Sample`], and the resulting
//! [`Selection`] names the drawn emotes in its caption. [`QuantumClient`] is the only adapter: it
//! sends one bounded request to the Q# sidecar, never retries and never falls back to classical
//! randomness. The `botge-quantum-certificate` crate in `quantum/proofs/certificate` checks that the
//! budget's widths match the 414 admissible configurations it simulates.

mod budget;
mod caption;
mod catalog;
mod client;
mod planner;
mod types;

#[doc(inline)]
pub use budget::{Budget, BudgetError};
#[doc(inline)]
pub use catalog::Pools;
#[doc(inline)]
pub use client::{ClientError, QuantumClient};
#[doc(inline)]
pub use planner::{Plan, Selection};
#[doc(inline)]
pub use types::{EntangleRequest, OutOfRange, QuantumError, Sample, Secret, Size, Steps};

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
