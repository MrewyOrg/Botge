#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
  mkdir -p "$REPO/quantum/docs" "$REPO/chemistry/docs"
  touch "$REPO/.chktexrc" "$REPO/quantum/docs/botge-quantum.tex" "$REPO/chemistry/docs/botge-chemistry.tex"
  record chktex
  stub lacheck << 'SH'
if [ -n "${LACHECK_OUTPUT:-}" ]; then
  printf '%s\n' "$LACHECK_OUTPUT"
fi
SH
  stub latexmk << 'SH'
auxdir=""
outdir=""
last_arg=""
for arg in "$@"; do
  last_arg="$arg"
  case "$arg" in
    -auxdir=*) auxdir=${arg#-auxdir=} ;;
    -outdir=*) outdir=${arg#-outdir=} ;;
  esac
done
stem=$(basename "$last_arg" .tex)
mkdir -p "$auxdir" "$outdir"
: > "$outdir/${stem}.pdf"
if [ -n "${BAD_LOG:-}" ] && [ "$auxdir" = "tmp/latex" ]; then
  printf '%s\n' "$BAD_LOG" > "$auxdir/${stem}.log"
else
  printf 'Package nag Info: Loaded\nNo complaints by nag.\n' > "$auxdir/${stem}.log"
fi
SH
}

@test "LaTeX check runs ChkTeX, LaCheck, dark and light builds, audits logs, and cleans tmp" {
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -eq 0 ]
  called 'chktex -eall -n22 -n30 -q quantum/docs/botge-quantum.tex'
  called 'lacheck quantum/docs/botge-quantum.tex'
  called '-auxdir=tmp/latex -outdir=quantum/docs'
  called 'chktex -eall -n22 -n30 -q chemistry/docs/botge-chemistry.tex'
  called 'lacheck chemistry/docs/botge-chemistry.tex'
  called '-auxdir=tmp/latex -outdir=chemistry/docs'
  called '-usepretex=\def\BotgeDarkMode{0}'
  [ ! -d "$REPO/tmp/latex" ]
  [ ! -d "$REPO/tmp/latex_light" ]
}

@test "LaTeX check fails clearly when a required TeX tool is missing" {
  rm "$STUBS/lacheck"
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Missing lacheck'* ]]
}

@test "LaTeX check fails when LaCheck emits diagnostics" {
  export LACHECK_OUTPUT='"quantum/docs/botge-quantum.tex", line 10: possible unwanted space'
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *'possible unwanted space'* ]]
}

@test "LaTeX check rejects missing nag confirmation and TeX log warnings or box overflows" {
  export BAD_LOG='This is pdfTeX'
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Expected nag confirmation'* ]]

  export BAD_LOG=$(printf 'No complaints by nag.\nOverfull \\hbox (12.0pt too wide)\n')
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Overfull \hbox'* ]]
}

@test "LaTeX check fails when stray build artifacts appear in quantum/docs" {
  touch "$REPO/quantum/docs/botge-quantum.synctex.gz"
  run call_sh "$REPO/scripts/quality/check-latex.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Unexpected artifacts in quantum/docs'* ]]
  [[ "$output" == *'quantum/docs/botge-quantum.synctex.gz'* ]]
}
