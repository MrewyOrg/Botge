#!/bin/sh
set -eu

script_directory=$(dirname "$0")
cd "${script_directory}/../.."

for tool in chktex lacheck latexmk; do
  if ! command -v "${tool}" > /dev/null 2>&1; then
    printf 'Missing %s; install TeX Live before running LaTeX checks.\n' "${tool}" >&2
    exit 1
  fi
done

tex_file='quantum/docs/botge-quantum.tex'
mkdir -p tmp/latex tmp/latex_light
trap 'rm -rf tmp/latex tmp/latex_light' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# chktex reads ./.chktexrc from the repository root on its own.
chktex -eall -n22 -n30 -q "${tex_file}"

lacheck_output=$(lacheck "${tex_file}" 2>&1)
if [ -n "${lacheck_output}" ]; then
  printf '%s\n' "${lacheck_output}" >&2
  exit 1
fi

latexmk -pdf -emulate-aux-dir -auxdir=tmp/latex -outdir=quantum/docs \
  -interaction=nonstopmode -halt-on-error -file-line-error -synctex=0 -g "${tex_file}" > /dev/null
latexmk -pdf -emulate-aux-dir -auxdir=tmp/latex_light -outdir=tmp/latex_light \
  -interaction=nonstopmode -halt-on-error -file-line-error -synctex=0 \
  -usepretex='\def\BotgeDarkMode{0}' -g "${tex_file}" > /dev/null

for log_file in tmp/latex/botge-quantum.log tmp/latex_light/botge-quantum.log; do
  if ! grep -Fq 'No complaints by nag.' "${log_file}"; then
    printf 'Expected nag confirmation in %s.\n' "${log_file}" >&2
    exit 1
  fi
  findings=$(
    grep -iE '(warning|overfull|underfull|error|undefined|multiply)' "${log_file}" \
      | grep -vE '(file:line:error|warning about old commands|Package nag Info|infwarerr)' || true
  )
  if [ -n "${findings}" ]; then
    printf '%s\n' "${findings}" >&2
    exit 1
  fi
done

directory_entries=$(find quantum/docs -mindepth 1 -maxdepth 1 | LC_ALL=C sort)
expected_entries=$(printf 'quantum/docs/botge-quantum.pdf\nquantum/docs/botge-quantum.tex')
if [ "${directory_entries}" != "${expected_entries}" ]; then
  printf 'Unexpected artifacts in quantum/docs:\n%s\n' "${directory_entries}" >&2
  exit 1
fi

printf 'LaTeX lint, dark/light PDF builds, log audit, and output directory checks passed.\n'
