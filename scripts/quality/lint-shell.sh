#!/bin/bash
set -euo pipefail

script_directory=$(dirname "$0")
cd "${script_directory}/../.."

if ! command -v shellcheck > /dev/null 2>&1; then
  printf '%s\n' 'Install ShellCheck before running shell lint.' >&2
  exit 1
fi

shell_shebang='^#!(.*[^[:alnum:]_])?(ba)?sh([^[:alnum:]_]|$)'
find botge_control scripts .agents/scripts .husky -type d -name _ -prune -o -type f -print0 | {
  files=()
  while IFS= read -r -d '' file; do
    IFS= read -r first_line < "${file}" || true
    if [[ "${first_line}" =~ ${shell_shebang} ]]; then
      files+=("${file}")
    fi
  done

  if ((${#files[@]} > 0)); then
    shellcheck "${files[@]}"
  fi
}
