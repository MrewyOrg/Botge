//! Activity HTTP routes and signed proxy request validation.
mod activity;
#[doc(inline)]
pub use activity::router;
pub mod proxy;

#[cfg(test)]
use botge_discord::{commands, discord};
#[cfg(test)]
use botge_test_support as tests;
#[cfg(test)]
fn initialize_tls() {
  drop(rustls::crypto::aws_lc_rs::default_provider().install_default());
}

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
