#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Keep coverage binaries from different toolchains out of the same report.
toolchain=$(rustup show active-toolchain)
CARGO_LLVM_COV_TARGET_DIR="${CARGO_LLVM_COV_TARGET_DIR:-target/llvm-cov-branch/${toolchain%% *}}"
export CARGO_LLVM_COV_TARGET_DIR

cargo llvm-cov --locked --branch --fail-under-file-lines 80 \
  --fail-under-functions 80 --fail-under-regions 80 "$@"

# Check each file's report separately, including branch coverage above 80%.
cargo llvm-cov report --offline --json --summary-only | jq --exit-status --raw-output '
  .data[]
  | if .totals.branches.count == 0 then error("Rust branch coverage is missing.") else . end
  | [.files[] | .filename as $file | .summary | to_entries[]
     | select(.value.count > 0)
     | select(
         if .key == "branches" then .value.percent <= 80
         elif .key == "lines" or .key == "functions" or .key == "regions" then .value.percent < 80
         else false end
       )
     | "\($file) \(.key): \(.value.percent)%"]
  | if length == 0 then "Every Rust file meets its coverage thresholds."
    else error(join("\n")) end
'
