#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

scope=${1:-static}
if [ "$#" -gt 0 ]; then shift; fi
case "${scope}" in
  static)
    cargo fmt --all --check
    cargo clippy --workspace --locked --all-targets -- -D warnings
    cargo doc --workspace --locked --no-deps --document-private-items
    cargo test --workspace --locked --doc
    ;;
  dependencies)
    cargo hack check --workspace --locked --feature-powerset --all-targets
    cargo udeps --workspace --locked --all-targets
    ;;
  coverage) sh scripts/check-rust-coverage.sh "$@" ;;
  miri) sh scripts/check-rust-miri.sh "$@" ;;
  bench) cargo bench --workspace --locked -- "$@" ;;
  *)
    printf '%s\n' 'Usage: sh scripts/check-rust.sh [static|dependencies|coverage|miri|bench]' >&2
    exit 2
    ;;
esac
