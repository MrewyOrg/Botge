#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

scope=${1:-static}
if [ "$#" -gt 0 ]; then shift; fi
case "${scope}" in
  static)
    cargo fmt --all --check
    cargo clippy --locked --all-targets -- -D warnings
    cargo doc --locked --no-deps --document-private-items
    cargo hack check --locked --feature-powerset --all-targets
    cargo udeps --locked --all-targets
    ;;
  coverage) sh scripts/check-rust-coverage.sh "$@" ;;
  miri) sh scripts/check-rust-miri.sh "$@" ;;
  bench) cargo bench --locked --bin botge -- "$@" ;;
  *)
    printf '%s\n' 'Usage: sh scripts/check-rust.sh [static|coverage|miri|bench]' >&2
    exit 2
    ;;
esac
