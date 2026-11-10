#!/bin/bash
set -euo pipefail

BOTGE_DOWNLOAD_DIR="$(dirname "$(realpath "$0")")/.."
readonly BOTGE_DOWNLOAD_DIR
cd "$BOTGE_DOWNLOAD_DIR"
BOTGE_CONTROL_NAME="$(basename "$PWD")"
readonly BOTGE_CONTROL_NAME

if [[ ! "$BOTGE_CONTROL_NAME" =~ ^[a-z_][a-z0-9_-]{0,23}$ ]]; then
  echo 'Run import_data from the saved /opt/<control-name>/botge_control directory.' >&2
  exit 1
fi

# shellcheck source=botge_control/config.sh
source botge_control/config
readonly BOTGE_CONTROL_LOCK="$BOTGE_RUNTIME_DIR/$BOTGE_CONTROL_NAME.lock"

# Open the user-owned lock only after dropping root. Opening it as root would follow
# symlinks in a directory controlled by the unprivileged account.
if (($# == 1)) && [[ "$1" == --receive ]]; then
  if ((EUID != BOTGE_CONTROL_UID)); then
    echo 'The import receiver must run as the configured control account.' >&2
    exit 1
  fi
  export XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR"
  export DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock"
  cd "$BOTGE_DIR"
  exec 9> "$BOTGE_CONTROL_LOCK"
  if ! flock -n 9; then
    echo 'Another control operation is running. Retry after it finishes.' >&2
    exit 1
  fi

  docker compose stop botge < /dev/null
  # Evaluate destination paths and variables in the container, not on the host.
  # shellcheck disable=SC2016
  docker compose run --rm --no-deps -T --user node --entrypoint sh botge -ec '
    existing="$(find /app/data -mindepth 1 ! -path /app/data/tmp -print -quit)"
    readonly existing
    if [ -n "$existing" ] || [ -L /app/data/tmp ] \
      || { [ -e /app/data/tmp ] && [ ! -d /app/data/tmp ]; }; then
      echo "Destination data volume is not empty. Import cancelled." >&2
      exit 1
    fi
    umask 077
    tar --no-same-owner -xf - -C /app/data
    chmod -R u=rwX,go= /app/data
  '
  exit
fi

if ((EUID != 0)); then
  echo 'Run with: sudo bash botge_control/import_data <data-directory>' >&2
  exit 1
fi
if (($# != 1)) || [[ ! -d "$1" ]]; then
  echo 'Usage: sudo bash botge_control/import_data <existing-data-directory>' >&2
  exit 1
fi

BOTGE_SOURCE_DIR="$(realpath "$1")"
readonly BOTGE_SOURCE_DIR
if [[ "$(id -u "$BOTGE_CONTROL_USER")" != "$BOTGE_CONTROL_UID" ]]; then
  echo 'The control account UID does not match the saved configuration.' >&2
  exit 1
fi

tar -C "$BOTGE_SOURCE_DIR" -cf - . \
  | runuser -u "$BOTGE_CONTROL_USER" -- \
    bash "$BOTGE_DOWNLOAD_DIR/botge_control/import_data" --receive

echo 'Data imported successfully. Botge remains stopped; start it when ready.'
