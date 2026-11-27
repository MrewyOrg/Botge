#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
  export BOTGE_DIR="$BATS_TEST_TMPDIR/app"
  export BOTGE_RUNTIME_DIR="$BATS_TEST_TMPDIR/runtime"
  export BOTGE_CONTROL_LOCK="$BOTGE_RUNTIME_DIR/control.lock"
  export BOTGE_CONTROL_SOCKET="$BOTGE_RUNTIME_DIR/control.sock"
  mkdir -p "$BOTGE_DIR" "$BOTGE_RUNTIME_DIR"
  export CANDIDATE="sha256:$(printf 'a%.0s' {1..64})"
  export PREVIOUS="mrewy/botge@sha256:$(printf 'b%.0s' {1..64})"
  export PREVIOUS_QUANTUM="mrewy/botge-quantum@sha256:$(printf 'c%.0s' {1..64})"
}

control_docker() {
  stub docker << 'SH'
case "$1 $2" in
  'compose config')
    if [[ "${3:-}" = --services ]]; then
      printf '%s\n' ${COMPOSE_SERVICES:-nginx botge quantum}
    else
      printf '{"services":{"botge":{"image":"%s"},"quantum":{"image":"%s"}}}\n' \
        "${COMPOSE_IMAGE:-${BOTGE_IMAGE:-}}" "${COMPOSE_QUANTUM_IMAGE:-${BOTGE_QUANTUM_IMAGE:-}}"
    fi
    ;;
  'compose up')
    printf 'image=%s quantum_image=%s\n' "${BOTGE_IMAGE:-}" "${BOTGE_QUANTUM_IMAGE:-}" >> "$CALLS"
    case "$*" in
      *'--pull always'*) exit "${DEPLOY_FAIL:-0}" ;;
      *'--no-deps'*) exit "${ROLLBACK_FAIL:-0}" ;;
      *) exit "${UP_FAIL:-0}" ;;
    esac
    ;;
  'compose stop') exit "${STOP_FAIL:-0}" ;;
  'compose ps')
    if [[ "${4:-}" = quantum ]]; then
      printf '%s\n' "${QUANTUM_CONTAINER:-quantum-123}"
    else
      printf '%s\n' "${CONTAINER:-container-123}"
    fi
    ;;
  'inspect --format')
    case "$3" in
      *Config.Image*)
        if [[ "${4:-}" = quantum-123 ]]; then
          printf '%s\n' "${RUNNING_IMAGE:-${BOTGE_QUANTUM_IMAGE:-}}"
        else
          printf '%s\n' "${RUNNING_IMAGE:-${BOTGE_IMAGE:-}}"
        fi
        ;;
      *State.Health.Status*) printf '%s\n' "${HEALTH:-healthy}" ;;
    esac
    ;;
esac
SH
}

send_request() {
  if [[ $# -eq 0 ]]; then
    bash "$REPO/botge_control/bin/botge_control.sh" < /dev/null
  else
    printf '%s\n' "$1" | bash "$REPO/botge_control/bin/botge_control.sh"
  fi
}

@test "Control handler rejects malformed or misconfigured requests before touching Docker" {
  control_docker
  run send_request
  [ "$status" -eq 1 ]
  [ "$output" = ERROR ]
  run send_request 'DEPLOY tag'
  [ "$status" -eq 1 ]
  [ "$output" = DENIED ]
  export BOTGE_RUNTIME_DIR=
  run send_request UP
  [ "$status" -eq 1 ]
  [ "$output" = ERROR ]
  never_called 'docker '
}

@test "Control handler reports an unavailable directory, lock errors, and competing actions" {
  control_docker
  original="$BOTGE_DIR"
  export BOTGE_DIR="$BOTGE_DIR/missing"
  run send_request UP
  [ "$status" -eq 1 ]
  [[ "$output" == *ERROR ]]
  export BOTGE_DIR="$original"
  original_lock="$BOTGE_CONTROL_LOCK"
  export BOTGE_CONTROL_LOCK="$BOTGE_CONTROL_LOCK/missing"
  run send_request UP
  [ "$status" -eq 1 ]
  [[ "$output" == *ERROR ]]
  export BOTGE_CONTROL_LOCK="$original_lock"
  exec 8> "$BOTGE_CONTROL_LOCK"
  flock -n 8
  run send_request STOP
  [ "$status" -eq 1 ]
  [ "$output" = BUSY ]
  exec 8>&-
  never_called 'docker '
}

@test "Control handler uses the saved digest on UP and propagates failed UP and STOP operations" {
  control_docker
  printf '%s\n' "$PREVIOUS" > "$BOTGE_DIR/.botge-image"
  run send_request UP
  [ "$status" -eq 0 ]
  [ "$output" = OK ]
  called "image=$PREVIOUS"
  run send_request STOP
  [ "$status" -eq 0 ]
  called 'docker compose stop'
  export UP_FAIL=1 STOP_FAIL=1
  run send_request UP
  [ "$status" -eq 1 ]
  [ "$output" = ERROR ]
  run send_request STOP
  [ "$status" -eq 1 ]
  [ "$output" = ERROR ]
  printf 'unverified tag\n' > "$BOTGE_DIR/.botge-image"
  : > "$CALLS"
  run send_request UP
  [ "$status" -eq 1 ]
  never_called 'docker '
}

@test "Control handler commits an approved digest only after configuration and readiness agree" {
  control_docker
  export COMPOSE_IMAGE=mrewy/botge:latest
  run send_request "DEPLOY $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Compose must use BOTGE_IMAGE'* ]]
  never_called 'compose up'
  [ ! -e "$BOTGE_DIR/.botge-image" ]
  unset COMPOSE_IMAGE
  run send_request "DEPLOY $CANDIDATE"
  [ "$status" -eq 0 ]
  [ "$output" = OK ]
  [ "$(cat "$BOTGE_DIR/.botge-image")" = "mrewy/botge@$CANDIDATE" ]
  called 'compose up -d --no-deps --pull always --wait'
  called '{{.State.Health.Status}}'
  run send_request DEPLOY
  [ "$status" -eq 0 ]
  [ "$(cat "$BOTGE_DIR/.botge-image")" = "mrewy/botge@$CANDIDATE" ]
}

@test "Failed deployments keep the saved digest and report rollback outcomes" {
  control_docker
  export DEPLOY_FAIL=1
  run send_request "DEPLOY $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'No verified previous image'* ]]
  [ ! -e "$BOTGE_DIR/.botge-image" ]
  printf '%s\n' "$PREVIOUS" > "$BOTGE_DIR/.botge-image"
  run send_request "DEPLOY $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Restored the previous image'* ]]
  export DEPLOY_FAIL=0 HEALTH=unhealthy ROLLBACK_FAIL=1
  run send_request "DEPLOY $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Running image or readiness does not match'* ]]
  [[ "$output" == *'Could not restore the previous image'* ]]
  [ "$(cat "$BOTGE_DIR/.botge-image")" = "$PREVIOUS" ]
}

@test "Control handler deploys, verifies, and skips optional quantum sidecar" {
  control_docker
  printf 'unverified tag\n' > "$BOTGE_DIR/.botge-quantum-image"
  run send_request UP
  [ "$status" -eq 1 ]
  never_called 'compose up'
  rm -f "$BOTGE_DIR/.botge-quantum-image"

  export COMPOSE_SERVICES='nginx botge'
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *'Quantum sidecar is not configured'* ]]
  [[ "$output" == *OK ]]
  never_called 'compose up'

  export COMPOSE_SERVICES='nginx botge quantum'
  export COMPOSE_QUANTUM_IMAGE=mrewy/botge-quantum:latest
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Compose must use BOTGE_QUANTUM_IMAGE'* ]]
  [ ! -e "$BOTGE_DIR/.botge-quantum-image" ]

  unset COMPOSE_QUANTUM_IMAGE
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 0 ]
  [ "$output" = OK ]
  [ "$(cat "$BOTGE_DIR/.botge-quantum-image")" = "mrewy/botge-quantum@$CANDIDATE" ]
  called 'compose up -d --no-deps --pull always --wait --wait-timeout 120 quantum'

  run send_request DEPLOY_QUANTUM
  [ "$status" -eq 0 ]
  [[ "$output" == *'Deploying pinned quantum image from .botge-quantum-image:'* ]]
  [[ "$output" == *OK ]]
  [ "$(cat "$BOTGE_DIR/.botge-quantum-image")" = "mrewy/botge-quantum@$CANDIDATE" ]
}

@test "Failed quantum deployments keep the saved digest and report rollback outcomes" {
  control_docker
  export DEPLOY_FAIL=1
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'No verified previous quantum image'* ]]
  [ ! -e "$BOTGE_DIR/.botge-quantum-image" ]

  printf '%s\n' "$PREVIOUS_QUANTUM" > "$BOTGE_DIR/.botge-quantum-image"
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Restored the previous quantum image'* ]]

  export DEPLOY_FAIL=0 HEALTH=unhealthy ROLLBACK_FAIL=1
  run send_request "DEPLOY_QUANTUM $CANDIDATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Running quantum image or readiness does not match'* ]]
  [[ "$output" == *'Could not restore the previous quantum image'* ]]
  [ "$(cat "$BOTGE_DIR/.botge-quantum-image")" = "$PREVIOUS_QUANTUM" ]
}

@test "Control client validates requests and distinguishes transport and server failures" {
  stub socat << 'SH'
cat >> "$CALLS"
printf '%s' "${SOCKET_RESULT-OK}"
exit "${SOCKET_EXIT:-0}"
SH
  client="$REPO/scripts/operations/botge-control.sh"
  run bash "$client"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Usage:'* ]]
  run bash "$client" restart
  [ "$status" -eq 1 ]
  [[ "$output" == *'Invalid action'* ]]
  run bash "$client" stop "$CANDIDATE"
  [ "$status" -eq 1 ]
  run bash "$client" deploy latest
  [ "$status" -eq 1 ]
  never_called 'socat '
  for action in up stop deploy; do
    run bash "$client" "$action"
    [ "$status" -eq 0 ]
    grep -Fx "${action^^}" "$CALLS"
  done
  run bash "$client" deploy "$CANDIDATE"
  [ "$status" -eq 0 ]
  grep -Fx "DEPLOY $CANDIDATE" "$CALLS"
  run bash "$client" deploy-quantum
  [ "$status" -eq 0 ]
  grep -Fx 'DEPLOY_QUANTUM' "$CALLS"
  run bash "$client" deploy-quantum "$CANDIDATE"
  [ "$status" -eq 0 ]
  grep -Fx "DEPLOY_QUANTUM $CANDIDATE" "$CALLS"
  called "UNIX-CONNECT:$BOTGE_CONTROL_SOCKET"
  export SOCKET_EXIT=7
  run bash "$client" up
  [ "$status" -eq 1 ]
  [[ "$output" == *'Unable to communicate'* ]]
  export SOCKET_EXIT=0 SOCKET_RESULT=BUSY
  run bash "$client" up
  [ "$status" -eq 1 ]
  [[ "$output" == *'failed: BUSY'* ]]
  export SOCKET_RESULT=
  run bash "$client" up
  [ "$status" -eq 1 ]
  [[ "$output" == *'no response'* ]]
}

backup_docker() {
  stub docker << 'SH'
case "$1 $2" in
  'compose ps') printf '%s\n' "${BACKUP_CONTAINER-container-123}" ;;
  'compose stop'|'compose start') ;;
  'inspect --format')
    case "$3" in
      *Config*) printf '{"WorkingDir":"/app","Env":["BOTGE_DATA_DIR=%s"]}\n' "${BACKUP_DATA:-data}" ;;
      *Image*) printf 'sha256:fixture\n' ;;
    esac
    ;;
  'cp container-123:/app/data/botge.redb') printf 'backup fixture\n' > "$3" ;;
  'run --rm')
    [ "${BACKUP_VERIFY_FAIL:-0}" = 0 ]
    ;;
  *) exit 3 ;;
esac
SH
}

@test "Compose backup verifies the copied database and restarts the original container" {
  backup_docker
  printf '%s\n' "$PREVIOUS" > "$BOTGE_DIR/.botge-image"
  destination="$BATS_TEST_TMPDIR/backup with spaces"
  run bash "$REPO/scripts/operations/backup-compose.sh" "$destination"
  [ "$status" -eq 0 ]
  [ "$(cat "$destination/image-id")" = 'sha256:fixture' ]
  (cd "$destination" && sha256sum --check SHA256SUMS)
  called 'docker compose stop --timeout 60 botge'
  called 'docker run --rm --network none --read-only --cap-drop ALL'
  called 'docker compose start --wait --wait-timeout 120 botge'
  export BACKUP_VERIFY_FAIL=1
  : > "$CALLS"
  run bash "$REPO/scripts/operations/backup-compose.sh" "$destination.failed"
  [ "$status" -eq 1 ]
  [ ! -e "$destination.failed/SHA256SUMS" ]
  called 'docker compose start --wait --wait-timeout 120 botge'
}

@test "Compose backup refuses an existing destination, a busy lock, or an unsupported data directory" {
  backup_docker
  script="$REPO/scripts/operations/backup-compose.sh"
  run bash "$script"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Usage:'* ]]
  run bash "$script" "$BATS_TEST_TMPDIR"
  [ "$status" -eq 1 ]
  [[ "$output" == *'never overwritten'* ]]
  exec 8> "$BOTGE_CONTROL_LOCK"
  flock -n 8
  run bash "$script" "$BATS_TEST_TMPDIR/backup"
  [ "$status" -eq 1 ]
  [[ "$output" == *'Another deployment or import'* ]]
  exec 8>&-
  never_called 'docker '
  export BACKUP_CONTAINER=
  run bash "$script" "$BATS_TEST_TMPDIR/backup"
  [ "$status" -eq 1 ]
  [[ "$output" == *'must be running'* ]]
  unset BACKUP_CONTAINER
  export BACKUP_DATA=/unexpected
  run bash "$script" "$BATS_TEST_TMPDIR/backup"
  [ "$status" -eq 1 ]
  [[ "$output" == *'not stopped'* ]]
  never_called 'docker compose stop'
}
