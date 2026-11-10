#!/bin/bash
# cspell:words journalctl
set -euo pipefail

if ((EUID != 0)); then
  echo 'Run with: sudo bash botge_control/inspect' >&2
  exit 1
fi

BOTGE_DOWNLOAD_DIR="$(dirname "$(realpath "$0")")/.."
readonly BOTGE_DOWNLOAD_DIR
cd "$BOTGE_DOWNLOAD_DIR"
BOTGE_CONTROL_NAME="$(basename "$PWD")"
readonly BOTGE_CONTROL_NAME

if [[ ! "$BOTGE_CONTROL_NAME" =~ ^[a-z_][a-z0-9_-]{0,23}$ ]]; then
  echo 'Run inspect from the saved /opt/<control-name>/botge_control directory.' >&2
  exit 1
fi

# shellcheck source=botge_control/config.sh
source botge_control/config

INSPECT_STATUS=0

# Keep collecting diagnostics even when a service or Docker command fails.
check() {
  local -r label="$1"
  shift
  printf '\n%s\n' "$label"
  if ! "$@"; then
    printf 'Check failed: %s\n' "$label" >&2
    INSPECT_STATUS=1
  fi
}

check 'Control socket status' \
  systemctl --no-pager status "$BOTGE_CONTROL_NAME.socket"
check 'Recent control handler logs' \
  journalctl -u "${BOTGE_CONTROL_NAME}@*.service" -n 100 --no-pager
check 'Rootless Docker status' \
  systemctl --user --machine="${BOTGE_CONTROL_USER}@.host" --no-pager status docker.service
check 'Compose container status' \
  runuser -u "$BOTGE_CONTROL_USER" -- env \
  XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR" \
  DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock" \
  docker compose --project-directory "$BOTGE_DIR" ps -a
check 'Recent Botge logs' \
  runuser -u "$BOTGE_CONTROL_USER" -- env \
  XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR" \
  DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock" \
  docker compose --project-directory "$BOTGE_DIR" logs --tail 100 botge

printf '\n%s\n' \
  'For socket permission errors, check group membership and reconnect after changing it.' \
  'For restarts or missing data, check application logs, configuration, and volume ownership.'

exit "$INSPECT_STATUS"
