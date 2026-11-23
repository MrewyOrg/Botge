setup_stubs() {
  if [[ ${BOTGE_TEST_REPO:-} != /tmp/botge-shell-*/work ||
    "$BATS_TEST_DIRNAME" != "$BOTGE_TEST_REPO/tests/shell" ||
    ! -d ${BOTGE_TEST_TOOLS:-} ]]; then
    printf '%s\n' 'Use npm run test:shell to run in the temporary test workspace.' >&2
    return 1
  fi
  export REPO="$BOTGE_TEST_REPO"
  export STUBS="$BATS_TEST_TMPDIR/bin"
  export CALLS="$BATS_TEST_TMPDIR/calls"
  export HOME="$BATS_TEST_TMPDIR/home"
  export BOTGE_TEST_ROOT="$BATS_TEST_TMPDIR/host"
  export BOTGE_TEST_EUID=0
  mkdir -p "$STUBS" "$HOME" "$BOTGE_TEST_ROOT/etc"
  printf 'ID=debian\nVERSION_ID=13\nVERSION_CODENAME=trixie\n' > "$BOTGE_TEST_ROOT/etc/os-release"
  touch "$CALLS"
  export PATH="$STUBS:$BOTGE_TEST_TOOLS"
}

stub() {
  local file="$STUBS/$1"
  {
    printf '%s\n' '#!/bin/sh' 'set -eu' 'printf "%s %s\n" "${0##*/}" "$*" >> "$CALLS"'
    cat
  } > "$file"
  chmod +x "$file"
}

record() {
  local tool
  for tool in "$@"; do
    stub "$tool" << 'SH'
exit 0
SH
  done
}

call_sh() {
  if [[ ${BOTGE_SHELL_COVERAGE:-} == 1 ]]; then
    bash "$@"
  else
    /bin/sh "$@"
  fi
}

called() {
  grep -F -- "$*" "$CALLS"
}

never_called() {
  ! grep -F -- "$*" "$CALLS"
}
