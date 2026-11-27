//! Statevector simulator for the computer-assisted certificate of `quantum/docs/botge-quantum.tex`.
//!
//! [`admissible`] enumerates the 414 register configurations Botge can run, [`State`] simulates the
//! Ising-Rx circuit for one of them, and [`Metrics`] derives every quantity that Proposition 5.2
//! and Table 1 bound. Every computed value is an [`Interval`] that contains the exact real value,
//! so `tests/certificate_414.rs` turns the sweep into a computer-assisted proof of those bounds.
//! Unit tests check the simulator against closed forms and the production register budget.

mod config;
mod entropy;
mod interval;
mod metrics;
mod state;

#[doc(inline)]
pub use config::{Config, admissible, coupling_scale};
#[doc(inline)]
pub use entropy::{collision_entropy, entropy};
#[doc(inline)]
pub use interval::Interval;
#[doc(inline)]
pub use metrics::{Metrics, arg_min, sweep};
#[doc(inline)]
pub use state::State;
