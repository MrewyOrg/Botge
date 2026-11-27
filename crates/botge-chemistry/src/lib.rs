//! Deterministic organic atlas, pool planner, and sidecar client behind `/react-emote`.
//!
//! Mirrors `botge-quantum` with pure, Miri-checked domain modules (`atlas`, `budget`, `catalog`,
//! `planner`, `caption`, `types`) and one bounded `reqwest` adapter (`ChemistryClient`) targeting
//! the CPU-only `RDKit` sidecar with a 3-second timeout, at most four in-flight requests, no
//! retries, and no fake reaction fallback.

mod atlas;
mod budget;
mod caption;
mod catalog;
mod client;
mod planner;
mod types;

#[doc(inline)]
pub use atlas::{
  ATLAS_SIZE, AtlasIndex, SubstrateInfo, can_react, can_react_any, substrate, substrate_index,
};
#[doc(inline)]
pub use budget::{Budget, BudgetError};
#[doc(inline)]
pub use catalog::Pools;
#[doc(inline)]
pub use client::{ChemistryClient, ClientError};
#[doc(inline)]
pub use planner::{NoReactionReport, Outcome, Plan, ReactionSelection};
#[doc(inline)]
pub use types::{
  ChemError, Condition, Diagram, OutOfRange, ReactRequest, ReactResponse, Secret, Size,
};

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
