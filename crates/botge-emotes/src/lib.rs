//! Provider clients, snapshot ownership and bounded media rendering.
#![cfg_attr(test, feature(test))]
#[cfg(test)]
extern crate test;
mod emotes;
#[cfg(test)]
use botge_test_support as tests;
#[doc(inline)]
pub use emotes::{Emotes, catalog, rendering};

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
