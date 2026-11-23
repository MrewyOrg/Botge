#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."

# Keep coverage binaries from different toolchains out of the same report.
toolchain=$(rustup show active-toolchain)
CARGO_LLVM_COV_TARGET_DIR="${CARGO_LLVM_COV_TARGET_DIR:-target/llvm-cov-branch/${toolchain%% *}}"
export CARGO_LLVM_COV_TARGET_DIR

cargo llvm-cov --workspace --locked --branch --fail-under-file-lines 95 \
  --fail-under-functions 95 --fail-under-regions 95 "$@"

# Require at least 95% for every measured category in every source file.
cargo llvm-cov report --workspace --offline --json --summary-only | jq --exit-status --raw-output -f scripts/rust/coverage.jq
