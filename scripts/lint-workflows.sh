#!/bin/sh
set -eu

script_directory=$(dirname "$0")
cd "${script_directory}/.."

if ! command -v shellcheck > /dev/null 2>&1 || ! command -v actionlint > /dev/null 2>&1; then
  printf '%s\n' 'Install actionlint and ShellCheck before running workflow lint.' >&2
  exit 1
fi

directory=$(mktemp -d "${TMPDIR:-/tmp}/botge-actionlint.XXXXXX")
trap 'rm -rf -- "$directory"' EXIT
mkdir -p "${directory}/.github/workflows" "${directory}/.git"
cp .github/actionlint.yaml "${directory}/.github/actionlint.yaml"
# Workflows reference local composite actions, which actionlint reads from the copy.
if [ -d .github/actions ]; then
  cp -R .github/actions "${directory}/.github/actions"
fi

# actionlint 1.7.x predates GitHub's $/ syntax. Normalize copies for linting.
for workflow in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "${workflow}" ] || continue
  sed -E 's@^([[:blank:]]*(-[[:blank:]]+)?uses:[[:blank:]]*)\$/@\1./@' \
    "${workflow}" > "${directory}/${workflow}"
done

cd "${directory}"
actionlint -color=false
