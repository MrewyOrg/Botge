#!/bin/sh
set -eu

# Lints the given Swift files from ios/, where SwiftLint finds its root and nested configurations.
# lint-staged passes absolute paths; files outside the configured targets are skipped.

cd "$(dirname "$0")/../../ios"
exec Tools/bin/swiftlint lint --strict --quiet --force-exclude "$@"
