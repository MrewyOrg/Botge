#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
}

@test "Activity staging builds the production catalog and stages only after Vite succeeds" {
  stub npm << 'SH'
[ "$PWD" = "$REPO" ]
[ "$VITE_ENABLE_ACTIVITY_CATALOG:$VITE_ENABLE_ACTIVITY_ADDS:$VITE_ENABLE_ACTIVITY_SETTINGS:$VITE_ENABLE_ACTIVITY_GAME:$VITE_ENABLE_7TV_DISCOVERY" = true:true:true:true:true ]
exit "${BUILD_STATUS:-0}"
SH
  record node
  cd "$BATS_TEST_TMPDIR"
  run call_sh "$REPO/scripts/activity/stage-activity-server.sh"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS")" = "$(printf '%s\n' 'npm run build -w activity -- --manifest' 'node activity/scripts/stage-server-site.ts')" ]
  : > "$CALLS"
  export BUILD_STATUS=23
  run call_sh "$REPO/scripts/activity/stage-activity-server.sh"
  [ "$status" -eq 23 ]
  never_called 'node '
}

stub_go() {
  mkdir -p "$REPO/activity/server/tools"
  record golangci-lint
  stub node << 'SH'
[ -s "$3" ]
printf '%s' "$3" > "$CALLS.imports"
SH
  stub go << 'SH'
[ "$GOTOOLCHAIN:$GOWORK" = local:off ]
case "$*" in
  *' list '*'-deps '*) printf '{"Standard":true}\n' ;;
  *' list '*'-f '*) printf '%s/activity/server/server.go\n' "$REPO" ;;
  *' run '*fielddocs) grep -Fx "$REPO/activity/server/server.go" ;;
  *' build '*) [ "$CGO_ENABLED:$GOOS:$GOARCH" = 0:linux:amd64 ] ;;
  *' test '*'-race '*) [ "$CGO_ENABLED" = 1 ] && [ -d "$BOTGE_GO_COVERDIR" ] ;;
  *' tool go-test-coverage '*)
    printf 'fixture coverage report\n'
    exit "${GO_COVERAGE_STATUS:-0}"
    ;;
esac
SH
}

@test "Go checks use both modules and qualify source and binary after coverage" {
  stub_go
  run call_sh "$REPO/scripts/activity/check-activity-server.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'fixture coverage report'* ]]
  called 'go -C activity/server/tools mod verify'
  called 'go -C activity/server test -mod=readonly -race'
  called "tool go-test-coverage --source-dir $REPO/activity/server"
  called "tool govulncheck -C $REPO/activity/server ./..."
  called 'tool govulncheck -mode binary'
  [ ! -e "$(cat "$CALLS.imports")" ]
}

@test "Go coverage failure prints its report and skips qualification" {
  stub_go
  export GO_COVERAGE_STATUS=19
  run call_sh "$REPO/scripts/activity/check-activity-server.sh"
  [ "$status" -eq 19 ]
  [[ "$output" == *'fixture coverage report'* ]]
  never_called 'govulncheck'
  [ ! -e "$(cat "$CALLS.imports")" ]
}

@test "Go vulnerability refresh checks the sources and binary without repeating coverage" {
  stub_go
  run call_sh "$REPO/scripts/activity/check-activity-server.sh" --vulnerabilities-only
  [ "$status" -eq 0 ]
  called 'go -C activity/server build -trimpath -mod=readonly'
  called "tool govulncheck -C $REPO/activity/server ./..."
  called 'tool govulncheck -mode binary'
  never_called 'tool go-test-coverage'
  never_called 'golangci-lint'
}

@test "Rust entry points preserve static, dependency, benchmark, and Miri checks" {
  record cargo
  stub rustup << 'SH'
printf 'nightly-test (override)\n'
SH
  export RUST_REPORT='{"data":[{"totals":{"branches":{"count":1}},"files":[]}]}'
  stub cargo << 'SH'
case "$*" in
  'llvm-cov report '*) printf '%s\n' "$RUST_REPORT" ;;
esac
SH
  script="$REPO/scripts/rust/check-rust.sh"
  run call_sh "$script"
  [ "$status" -eq 0 ]
  called 'cargo fmt --all --check'
  called 'cargo test --workspace --locked --doc'
  run call_sh "$script" dependencies
  [ "$status" -eq 0 ]
  called 'cargo hack check --workspace --locked --feature-powerset'
  called 'cargo udeps --workspace'
  run call_sh "$script" bench emotes
  [ "$status" -eq 0 ]
  called 'cargo bench --workspace --locked -- emotes'
  run call_sh "$script" miri
  [ "$status" -eq 0 ]
  called 'cargo miri test --locked -p botge-domain'
  called 'cargo miri test --locked -p botge-quantum'
  called 'cargo miri test --locked -p botge-chemistry'
  called 'cargo miri test --locked -p botge-discord'
  called 'cargo miri test --locked -p botge-emotes'
  run call_sh "$script" coverage --no-clean
  [ "$status" -eq 0 ]
  called 'cargo llvm-cov --workspace --locked --branch'
  called '--no-clean'
  run call_sh "$script" invalid
  [ "$status" -eq 2 ]
  [[ "$output" == *'Usage:'* ]]
}

@test "Rust coverage rejects missing branch data and per-file shortfalls" {
  stub rustup << 'SH'
printf 'nightly-test (override)\n'
SH
  stub cargo << 'SH'
[ "$CARGO_LLVM_COV_TARGET_DIR" = target/llvm-cov-branch/nightly-test ]
case "$*" in
  'llvm-cov report '*) printf '%s\n' "$RUST_REPORT" ;;
esac
SH
  export RUST_REPORT='{"data":[{"totals":{"branches":{"count":0}},"files":[]}]}'
  script="$REPO/scripts/rust/check-rust-coverage.sh"
  run call_sh "$script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'Rust branch coverage is missing'* ]]
  export RUST_REPORT='{"data":[{"totals":{"branches":{"count":1}},"files":[{"filename":"test.rs","summary":{"branches":{"count":1,"percent":94}}}]}]}'
  run call_sh "$script"
  [ "$status" -ne 0 ]
  [[ "$output" == *'test.rs branches: 94%'* ]]
  export RUST_REPORT='{"data":[{"totals":{"branches":{"count":1}},"files":[{"filename":"test.rs","summary":{"branches":{"count":1,"percent":95}}}]}]}'
  run call_sh "$script"
  [ "$status" -eq 0 ]
  [[ "$output" == *'meets its coverage thresholds'* ]]
}

@test "Miri stops after a failed package instead of continuing to other crates" {
  stub cargo << 'SH'
if [ "$5" = botge-discord ]; then exit 29; fi
SH
  run call_sh "$REPO/scripts/rust/check-rust-miri.sh"
  [ "$status" -eq 29 ]
  called 'cargo miri test --locked -p botge-domain'
  called 'cargo miri test --locked -p botge-discord'
  never_called 'cargo miri test --locked -p botge-emotes'
  : > "$CALLS"
  record cargo
  run call_sh "$REPO/scripts/rust/check-rust-miri.sh"
  [ "$status" -eq 0 ]
  called 'cargo miri test --locked -p botge-emotes'
}

stub_ffmpeg() {
  stub uname << 'SH'
case "$1" in
  -s) echo "${TEST_SYSTEM:-Linux}" ;;
  -m) echo "${TEST_ARCH:-x86_64}" ;;
esac
SH
  record curl
  stub sha256sum << 'SH'
cat >> "$CALLS"
exit "${CHECKSUM_STATUS:-0}"
SH
  stub tar << 'SH'
[ "$4" = --directory ]
mkdir -p "$5/${6%/ffmpeg}"
printf 'ffmpeg fixture\n' > "$5/$6"
printf 'ffprobe fixture\n' > "$5/$7"
SH
}

@test "FFmpeg selects the pinned platform and installs both executables after verifying each checksum" {
  stub_ffmpeg
  script="$REPO/scripts/rust/install-test-ffmpeg.sh"
  for arch in x86_64 aarch64; do
    export TEST_ARCH="$arch"
    run call_sh "$script" "$BATS_TEST_TMPDIR/$arch"
    [ "$status" -eq 0 ]
    [ -x "$BATS_TEST_TMPDIR/$arch/ffmpeg" ]
    [ -x "$BATS_TEST_TMPDIR/$arch/ffprobe" ]
  done
  called 'linux64-lgpl'
  called 'linuxarm64-lgpl'
  called '63648ca32d6f831b6829f60d9fef3c9745f4dc4ad33d9ddd98ba2b5bca87e9e3'
  called '5fb88bdc315e808b07a607bedcbcaf609408508295aa2afd4beed810af8878f9'
}

@test "FFmpeg refuses invalid arguments, unsupported architectures, and bad downloads" {
  stub_ffmpeg
  script="$REPO/scripts/rust/install-test-ffmpeg.sh"
  run call_sh "$script"
  [ "$status" -eq 1 ]
  [[ "$output" == *'INSTALL_DIRECTORY'* ]]
  export TEST_SYSTEM=Darwin
  run call_sh "$script" "$BATS_TEST_TMPDIR/install"
  [ "$status" -eq 1 ]
  [[ "$output" == *'supports Linux AMD64 and ARM64'* ]]
  never_called 'curl '
  export TEST_SYSTEM=Linux CHECKSUM_STATUS=1
  run call_sh "$script" "$BATS_TEST_TMPDIR/install"
  [ "$status" -eq 1 ]
  never_called 'tar '
  [ ! -e "$BATS_TEST_TMPDIR/install" ]
}

@test "Dev Container setup uses locked tooling, isolated bootstrap, and the selected Node version" {
  stub_ffmpeg
  record npm sudo rustup cargo
  export NVM_DIR="$BATS_TEST_TMPDIR/nvm"
  mkdir -p "$NVM_DIR"
  cat > "$NVM_DIR/nvm.sh" << 'SH'
nvm() {
  printf 'nvm %s\n' "$*" >> "$CALLS"
  if [ "$1" = current ]; then echo v26.13.0; fi
}
SH
  stub python3 << 'SH'
if [ "$1" = -c ]; then
  echo '==1.2.3'
else
  mkdir -p "$3/bin"
  cat > "$3/bin/python" <<'PYTHON'
#!/bin/sh
printf 'bootstrap python %s\n' "$*" >> "$CALLS"
printf '#!/bin/sh\nprintf "uv %%s\\n" "$*" >> "$CALLS"\n' > "${0%/*}/uv"
PYTHON
  chmod +x "$3/bin/python"
fi
SH
  run bash "$REPO/scripts/setup/setup-devcontainer.sh"
  [ "$status" -eq 0 ]
  called 'nvm alias default v26.13.0'
  called 'npm ci'
  called 'bootstrap python -m pip install --disable-pip-version-check --no-deps uv==1.2.3'
  called 'uv sync --locked'
  called 'sudo install -m 0755'
  called 'cargo fetch --locked'
}

@test "Husky installation skips production and CI, and propagates local hook installation failure" {
  stub husky << 'SH'
exit 13
SH
  export NODE_ENV=production
  run call_sh "$REPO/.husky/install.sh"
  [ "$status" -eq 0 ]
  unset NODE_ENV
  export CI=true
  run call_sh "$REPO/.husky/install.sh"
  [ "$status" -eq 0 ]
  never_called 'husky '
  unset CI
  run call_sh "$REPO/.husky/install.sh"
  [ "$status" -eq 13 ]
  called 'husky '
}

@test "Shell lint reports missing ShellCheck and passes only shell entry points to it" {
  mkdir -p "$REPO/.agents/scripts"
  run bash "$REPO/scripts/quality/lint-shell.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Install ShellCheck'* ]]
  record shellcheck
  run bash "$REPO/scripts/quality/lint-shell.sh"
  [ "$status" -eq 0 ]
  called '.husky/install.sh'
  called 'scripts/activity/stage-activity-server.sh'
  never_called 'README.md'
}
