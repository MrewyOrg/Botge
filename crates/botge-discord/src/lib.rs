//! Discord gateway, command and identity adapters for shared application operations.
#![feature(once_cell_try)]
#![cfg_attr(test, feature(test))]
#[cfg(test)]
extern crate test;
pub mod commands;
pub mod discord;
#[cfg(test)]
use botge_storage as storage;
#[cfg(test)]
use botge_test_support as tests;
#[cfg(any(test, feature = "test-util"))]
pub mod test_support;

// Keep native test and benchmark allocation behavior aligned with the executable.
#[cfg(all(test, not(miri)))]
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;
