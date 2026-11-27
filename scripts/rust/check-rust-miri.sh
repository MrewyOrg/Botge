#!/bin/sh

set -eu

cd "$(dirname "$0")/../.."

# Interpret the existing pure Rust tests with Miri's default isolation and UB checks.
# Native integrations and larger stress fixtures run in the normal coverage suite.
cargo miri test --locked -p botge-domain --lib -- settings::tests::
cargo miri test --locked -p botge-quantum --lib -- \
  budget::tests:: caption::tests:: catalog::tests:: planner::tests:: types::tests::
cargo miri test --locked -p botge-discord --lib -- \
  commands::shortcuts::tests::shortcuts_preserve_exact_matches_aliases_and_unicode_boundaries
cargo miri test --locked -p botge-emotes --lib -- \
  emotes::rendering::layout::tests::fits_extreme_aspect_ratios_without_integer_overflow \
  emotes::rendering::webp::tests::rejects_incomplete_chunks_and_invalid_animation_header_lengths \
  emotes::rendering::webp::tests::handles_zero_delays_and_rejects_truncated_or_unrepresentable_frame_timing
