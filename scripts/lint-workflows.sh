#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if ! command -v shellcheck > /dev/null 2>&1 || ! command -v actionlint > /dev/null 2>&1; then
  printf '%s\n' 'Install actionlint and ShellCheck before running workflow lint.' >&2
  exit 1
fi

directory=$(mktemp -d "${TMPDIR:-/tmp}/botge-actionlint.XXXXXX")
trap 'rm -rf -- "$directory"' EXIT
mkdir -p "$directory/.github/workflows" "$directory/.git"

# actionlint 1.7.x predates GitHub's $/ syntax. Normalize copies for linting.
for workflow in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$workflow" ] || continue
  sed -E 's@^([[:blank:]]*(-[[:blank:]]+)?uses:[[:blank:]]*)\$/@\1./@' \
    "$workflow" > "$directory/$workflow"
done

cd "$directory"
actionlint -color=false
