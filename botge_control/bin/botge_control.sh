#!/bin/bash
set -euo pipefail

# The socket accepts one fixed command. Standard output is reserved for its protocol reply.
IFS= read -r -t 10 -n 32 BOTGE_CONTROL_REQUEST || {
  printf 'ERROR\n'
  exit 1
}
readonly BOTGE_CONTROL_REQUEST

case "$BOTGE_CONTROL_REQUEST" in
  DEPLOY | UP | STOP) ;;
  *)
    printf 'DENIED\n'
    exit 1
    ;;
esac

if [[ -z "${BOTGE_DIR:-}" || -z "${BOTGE_RUNTIME_DIR:-}" || -z "${BOTGE_CONTROL_LOCK:-}" ]]; then
  printf 'ERROR\n'
  exit 1
fi

export XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR"
export DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock"
readonly XDG_RUNTIME_DIR DOCKER_HOST

cd "$BOTGE_DIR" || {
  printf 'ERROR\n'
  exit 1
}

# Serialize Compose actions with other control requests and data imports.
if ! exec 9> "$BOTGE_CONTROL_LOCK"; then
  printf 'ERROR\n'
  exit 1
fi

if ! flock -n 9; then
  printf 'BUSY\n'
  exit 1
fi

case "$BOTGE_CONTROL_REQUEST" in
  UP)
    if ! docker compose up -d --wait --wait-timeout 120 >&2; then
      printf 'ERROR\n'
      exit 1
    fi
    ;;

  STOP)
    if ! docker compose stop >&2; then
      printf 'ERROR\n'
      exit 1
    fi
    ;;

  DEPLOY)
    if ! docker compose up -d --no-deps --pull always --wait --wait-timeout 120 botge >&2; then
      printf 'ERROR\n'
      exit 1
    fi

    if ! docker image prune -f >&2; then
      echo 'Warning: Botge is running, but unused image cleanup failed.' >&2
    fi
    ;;
esac

printf 'OK\n'
