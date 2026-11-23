//! Shared records and pure rules, independent of adapters, persistence and network clients.

pub mod catalog_history;
pub mod emotes;
pub mod providers;
pub mod settings;

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
