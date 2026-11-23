#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
  ln -sf config.sh "$REPO/botge_control/config"
  ln -sf import_data.sh "$REPO/botge_control/import_data"
}

socket_file() {
  python3 -c '
import socket, sys
with socket.socket(socket.AF_UNIX) as service:
    service.bind(sys.argv[1])
' "$1"
}

@test "Control configuration defines the account and its application paths" {
  run env BOTGE_CONTROL_NAME=fixture bash "$REPO/botge_control/config.sh"
  [ "$status" -eq 0 ]
  run bash -c 'BOTGE_CONTROL_NAME=fixture; source "$1"; env' _ "$REPO/botge_control/config.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'BOTGE_CONTROL_UID=4242'* ]]
  [[ "$output" == *"BOTGE_DIR=$BOTGE_TEST_ROOT/home/fixture/botge"* ]]
  [[ "$output" == *"BOTGE_RUNTIME_DIR=$BOTGE_TEST_ROOT/run/user/4242"* ]]
}

@test "Host commands require root, while the import receiver refuses root" {
  for script in inspect setup setup_docker teardown import_data; do
    run env BOTGE_TEST_EUID=65534 bash "$REPO/botge_control/$script.sh"
    [ "$status" -eq 1 ]
    [[ "$output" == *'Run '* ]]
  done
  run bash "$REPO/botge_control/import_data.sh" --receive
  [ "$status" -eq 1 ]
  [[ "$output" == *'receiver must run as the configured control account'* ]]
}

@test "Debian host tooling rejects an unsupported release before modifying the host" {
  record apt-get systemctl
  printf 'ID=debian\nVERSION_ID=12\n' > "$BOTGE_TEST_ROOT/etc/os-release"
  for script in setup setup_docker teardown; do
    run bash "$REPO/botge_control/$script.sh" fixture_ctl
    [ "$status" -eq 1 ]
    [[ "$output" == *'targets Debian 13'* ]]
  done
  never_called 'apt-get '
  never_called 'systemctl '
}

@test "Inspect continues its diagnostics after a dependency fails" {
  stub systemctl << 'SH'
exit "${SYSTEMCTL_FAIL:-0}"
SH
  record journalctl runuser
  run bash "$REPO/botge_control/inspect.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *'Recent Botge logs'* ]]
  called "docker compose --project-directory $BOTGE_TEST_ROOT/home/work/botge ps -a"
  : > "$CALLS"
  export SYSTEMCTL_FAIL=1
  run bash "$REPO/botge_control/inspect.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Check failed: Control socket status'* ]]
  called 'journalctl -u work@*.service'
  called 'logs --tail 100 botge'
}

stub_packages() {
  stub apt-get << 'SH'
if [ "$*" = 'install -y --no-upgrade docker-ce-rootless-extras' ]; then
  printf '#!/bin/sh\n:\n' > "${0%/*}/dockerd-rootless-setuptool.sh"
  chmod +x "${0%/*}/dockerd-rootless-setuptool.sh"
fi
SH
  stub dpkg << 'SH'
case "$1" in
  --get-selections) printf '%s' "${CONFLICTING_PACKAGES:-}" ;;
  --print-architecture) echo arm64 ;;
esac
SH
  stub curl << 'SH'
case "$1" in
  -fsSL) printf 'test key\n' > "$4" ;;
  *) cp "$REPO/${5#https://raw.githubusercontent.com/MrewyOrg/Botge/main/}" "$7" ;;
esac
SH
  record docker
}

@test "Docker setup removes installed conflicts and reuses its signing key" {
  stub_packages
  mkdir -p "$BOTGE_TEST_ROOT/etc/apt/sources.list.d"
  export CONFLICTING_PACKAGES=$'docker.io\tinstall\nrunc\tdeinstall\ncontainerd\tinstall\n'
  run bash "$REPO/botge_control/setup_docker.sh"
  [ "$status" -eq 0 ]
  called 'apt-get remove -y docker.io containerd'
  called 'curl -fsSL https://download.docker.com/linux/debian/gpg'
  called 'apt-get install -y --no-upgrade docker-ce-rootless-extras'
  grep -Fx "Signed-By: $BOTGE_TEST_ROOT/etc/apt/keyrings/docker.asc" \
    "$BOTGE_TEST_ROOT/etc/apt/sources.list.d/docker.sources"
  grep -Fx 'Architectures: arm64' "$BOTGE_TEST_ROOT/etc/apt/sources.list.d/docker.sources"
  : > "$CALLS"
  unset CONFLICTING_PACKAGES
  run bash "$REPO/botge_control/setup_docker.sh"
  [ "$status" -eq 0 ]
  never_called 'curl '
  never_called 'apt-get remove'
  never_called 'docker-ce-rootless-extras'
}

stub_accounts() {
  export ACCOUNT_FILE="$BATS_TEST_TMPDIR/account"
  stub id << 'SH'
case "$*" in
  '-u work'|'-u fixture_ctl') [ -f "$ACCOUNT_FILE" ]; echo "${TEST_UID:-4242}" ;;
  '-gn work'|'-gn fixture_ctl') printf '%s\n' "$2" ;;
  '-nG work'|'-nG fixture_ctl') printf '%s\n' "${TEST_GROUPS:-$2}" ;;
  work|fixture_ctl) [ -f "$ACCOUNT_FILE" ] ;;
  *) exec /usr/bin/id "$@" ;;
esac
SH
  stub getent << 'SH'
case "$*" in
  'passwd work'|'passwd fixture_ctl')
    [ -f "$ACCOUNT_FILE" ]
    printf '%s:x:4242:4242::%s/home/%s:/bin/bash\n' "$2" "$BOTGE_TEST_ROOT" "$2"
    ;;
  'passwd 4242') [ "${UID_TAKEN:-0}" = 1 ] ;;
  group*) [ "${GROUP_EXISTS:-0}" = 1 ] ;;
  *) exit 2 ;;
esac
SH
  stub useradd << 'SH'
touch "$ACCOUNT_FILE"
SH
  record groupadd groupdel loginctl userdel systemd-run systemd-analyze chown
  stub pgrep << 'SH'
[ "${PROCESSES_REMAIN:-0}" = 1 ]
SH
  stub install << 'SH'
# The account is mocked. Keep paths and modes while omitting ownership flags.
exec /usr/bin/python3 -c '
import os, sys
args = iter(sys.argv[1:])
selected = []
for arg in args:
    if arg in ("-o", "-g"):
        next(args)
    else:
        selected.append(arg)
os.execv("/usr/bin/install", ["install", *selected])
' "$@"
SH
  stub systemctl << 'SH'
if [ "$1" = list-units ]; then
  printf '\nwork@fixture.service loaded active running\n'
fi
SH
  stub runuser << 'SH'
case "$*" in
  *'docker info'*) echo "${DOCKER_SECURITY:-rootless}" ;;
  *'docker compose version'*) echo 'compose fixture' ;;
  *) exit 4 ;;
esac
SH
}

stub_host_setup() {
  stub_accounts
  stub_packages
  mkdir -p "$BOTGE_TEST_ROOT"/{etc/systemd/system,etc/apt/sources.list.d,run/user/4242,usr/local/bin}
}

@test "Host setup rejects invalid names and conflicting account settings" {
  stub_host_setup
  script="$REPO/botge_control/setup.sh"
  run bash "$script" Invalid
  [ "$status" -eq 1 ]
  [[ "$output" == *'Use 1-24 lowercase letters'* ]]
  never_called 'apt-get '
  export UID_TAKEN=1
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'already allocated'* ]]
  unset UID_TAKEN
  touch "$ACCOUNT_FILE"
  export TEST_UID=1234
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'unexpected UID, group, or home'* ]]
  unset TEST_UID
  export TEST_GROUPS='fixture_ctl docker'
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'Remove fixture_ctl from the docker group'* ]]
  never_called 'systemctl '
}

@test "Host setup preserves the installed client path and existing configuration" {
  stub_host_setup
  socket_file "$BOTGE_TEST_ROOT/run/user/4242/bus"
  socket_file "$BOTGE_TEST_ROOT/run/user/4242/docker.sock"
  socket_file "$BOTGE_TEST_ROOT/run/fixture_ctl.sock"
  run bash "$REPO/botge_control/setup.sh" fixture_ctl
  [ "$status" -eq 0 ]
  [[ "$output" == *'fixture_ctl setup completed'* ]]
  [ -x "$BOTGE_TEST_ROOT/usr/local/bin/fixture_ctl" ]
  cmp "$REPO/scripts/operations/botge-control.sh" "$BOTGE_TEST_ROOT/opt/fixture_ctl/scripts/botge-control"
  grep -F 'ListenStream=/run/fixture_ctl.sock' "$BOTGE_TEST_ROOT/etc/systemd/system/fixture_ctl.socket"
  grep -F 'User=fixture_ctl' "$BOTGE_TEST_ROOT/etc/systemd/system/fixture_ctl@.service"
  called 'systemd-run --user --machine=fixture_ctl@.host'
  called 'systemctl restart fixture_ctl.socket'
  echo 'fixture operator settings' > "$BOTGE_TEST_ROOT/home/fixture_ctl/botge/.env"
  : > "$CALLS"
  run bash "$REPO/botge_control/setup.sh" fixture_ctl
  [ "$status" -eq 0 ]
  grep -Fx 'fixture operator settings' "$BOTGE_TEST_ROOT/home/fixture_ctl/botge/.env"
  never_called 'main/botge_control/config.sh'
  never_called 'useradd '
}

@test "Host setup checks the user bus, Docker socket, and rootless mode before activation" {
  stub_host_setup
  script="$REPO/botge_control/setup.sh"
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'User systemd/D-Bus session unavailable'* ]]
  socket_file "$BOTGE_TEST_ROOT/run/user/4242/bus"
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'Missing rootless Docker socket'* ]]
  socket_file "$BOTGE_TEST_ROOT/run/user/4242/docker.sock"
  export DOCKER_SECURITY=rootful
  run bash "$script" fixture_ctl
  [ "$status" -eq 1 ]
  [[ "$output" == *'Docker is not running in rootless mode'* ]]
  never_called 'systemctl restart fixture_ctl.socket'
}

@test "Teardown requires consent, honors the process guard, and preserves Docker packages" {
  stub_accounts
  touch "$ACCOUNT_FILE"
  export GROUP_EXISTS=1
  mkdir -p "$BOTGE_TEST_ROOT/etc/systemd/system"
  touch "$BOTGE_TEST_ROOT/etc/systemd/system/work.socket"
  script="$REPO/botge_control/teardown.sh"
  run bash -c 'printf "NO\n" | bash "$1"' _ "$script"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Uninstallation cancelled'* ]]
  never_called 'systemctl '
  export PROCESSES_REMAIN=1
  run bash -c 'printf "DELETE\n" | bash "$1"' _ "$script"
  [ "$status" -eq 1 ]
  [[ "$output" == *'still running'* ]]
  never_called 'userdel '
  unset PROCESSES_REMAIN
  run bash -c 'printf "DELETE\n" | bash "$1"' _ "$script"
  [ "$status" -eq 0 ]
  called 'systemctl stop work@fixture.service'
  called 'loginctl terminate-user work'
  called 'userdel -r work'
  called 'groupdel work_trigger'
  [ ! -e "$BOTGE_TEST_ROOT/etc/systemd/system/work.socket" ]
  [[ "$output" == *'Docker packages and the Docker APT repository were preserved'* ]]
}

@test "Teardown rejects an account mismatch before attempting deletion" {
  stub_accounts
  touch "$ACCOUNT_FILE"
  export TEST_UID=1234
  run bash "$REPO/botge_control/teardown.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *'unexpected UID, group, or home'* ]]
  never_called 'userdel '
}

@test "Import refuses a missing directory or mismatched UID and streams the source after dropping root" {
  stub_accounts
  touch "$ACCOUNT_FILE"
  source_dir="$BATS_TEST_TMPDIR/source"
  mkdir "$source_dir"
  printf 'fixture database\n' > "$source_dir/botge.redb"
  script="$REPO/botge_control/import_data.sh"
  run bash "$script" "$source_dir/missing"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Usage:'* ]]
  export TEST_UID=1234
  run bash "$script" "$source_dir"
  [ "$status" -eq 1 ]
  [[ "$output" == *'UID does not match'* ]]
  never_called 'runuser '
  unset TEST_UID
  stub runuser << 'SH'
[ "$*" = "-u work -- bash $REPO/botge_control/../botge_control/import_data --receive" ]
tar -xOf - ./botge.redb
SH
  run bash "$script" "$source_dir"
  [ "$status" -eq 0 ]
  [[ "$output" == *'fixture database'* && "$output" == *'Botge remains stopped'* ]]
}

import_receiver() {
  BOTGE_TEST_EUID=4242 bash "$REPO/botge_control/import_data.sh" --receive
}

@test "Import receiver checks locking and runtime configuration before touching data" {
  mkdir -p "$BOTGE_TEST_ROOT"/{home/work/botge,run/user/4242,app/data}
  stub docker << 'SH'
case "$1 $2" in
  'compose config') printf '{"services":{"botge":{"environment":{"BOTGE_DATA_DIR":"%s"}}}}\n' "${IMPORT_DATA_DIR:-data}" ;;
  'compose stop') ;;
  'compose run')
    for script do :; done
    cd "${BOTGE_TEST_ROOT:?}/app"
    script=$(printf '%s' "$script" | sed "s@/app@$BOTGE_TEST_ROOT/app@g")
    exec sh -ec "$script"
    ;;
  *) exit 5 ;;
esac
SH
  exec 8> "$BOTGE_TEST_ROOT/run/user/4242/work.lock"
  flock -n 8
  run import_receiver
  [ "$status" -eq 1 ]
  [[ "$output" == *'Another control operation'* ]]
  exec 8>&-
  export IMPORT_DATA_DIR=/bad
  run import_receiver
  [ "$status" -eq 1 ]
  [[ "$output" == *'Botge was not stopped'* ]]
  never_called 'docker compose stop'
  unset IMPORT_DATA_DIR
  printf 'old fixture database\n' > "$BOTGE_TEST_ROOT/app/data/botge.redb"
  run import_receiver
  [ "$status" -eq 1 ]
  [[ "$output" == *'Destination data volume is not empty'* ]]
  grep -Fx 'old fixture database' "$BOTGE_TEST_ROOT/app/data/botge.redb"
  rm "$BOTGE_TEST_ROOT/app/data/botge.redb"
  mkdir "$BATS_TEST_TMPDIR/source"
  printf 'fixture database\n' > "$BATS_TEST_TMPDIR/source/botge.redb"
  tar -C "$BATS_TEST_TMPDIR/source" -cf "$BATS_TEST_TMPDIR/source.tar" botge.redb
  chmod a+r "$BATS_TEST_TMPDIR/source.tar"
  run import_receiver < "$BATS_TEST_TMPDIR/source.tar"
  [ "$status" -eq 0 ]
  called 'docker compose stop botge'
  called 'docker compose run --rm --no-deps -T --user 1000:1000 --entrypoint sh'
  grep -Fx 'fixture database' "$BOTGE_TEST_ROOT/app/data/botge.redb"
}
