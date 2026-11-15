#!/bin/bash
set -euo pipefail

# Accept fixed operations plus an optional immutable deployment digest. Never evaluate input.
IFS= read -r -t 10 -n 128 BOTGE_CONTROL_REQUEST || {
  printf 'ERROR\n'
  exit 1
}
readonly BOTGE_CONTROL_REQUEST
BOTGE_CONTROL_DIGEST=''
if [[ "${BOTGE_CONTROL_REQUEST}" =~ ^DEPLOY\ (sha256:[a-f0-9]{64})$ ]]; then
  BOTGE_CONTROL_DIGEST="${BASH_REMATCH[1]}"
  BOTGE_CONTROL_ACTION=DEPLOY
else
  BOTGE_CONTROL_ACTION="${BOTGE_CONTROL_REQUEST}"
fi

case "${BOTGE_CONTROL_ACTION}" in
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

export XDG_RUNTIME_DIR="${BOTGE_RUNTIME_DIR}"
export DOCKER_HOST="unix://${BOTGE_RUNTIME_DIR}/docker.sock"
readonly XDG_RUNTIME_DIR DOCKER_HOST

cd "${BOTGE_DIR}" || {
  printf 'ERROR\n'
  exit 1
}

# Serialize Compose actions with other control requests and data imports.
if ! exec 9> "${BOTGE_CONTROL_LOCK}"; then
  printf 'ERROR\n'
  exit 1
fi

if ! flock -n 9; then
  printf 'BUSY\n'
  exit 1
fi

# Keep the last verified digest across UP requests and host restarts.
previous_image=''
if [[ -f .botge-image ]]; then
  BOTGE_IMAGE=$(cat .botge-image)
  if [[ ! "${BOTGE_IMAGE}" =~ ^mrewy/botge@sha256:[a-f0-9]{64}$ ]]; then
    printf 'ERROR\n'
    exit 1
  fi
  export BOTGE_IMAGE
  previous_image="${BOTGE_IMAGE}"
fi

# Restores the last verified image after a failed digest deployment. Its result is logged only:
# the request still reports ERROR because the approved candidate was not deployed.
rollback() {
  if [[ -z "${previous_image}" ]]; then
    echo 'No verified previous image to restore.' >&2
    return
  fi
  if BOTGE_IMAGE="${previous_image}" docker compose up -d --no-deps --wait --wait-timeout 120 botge >&2; then
    echo "Restored the previous image ${previous_image}." >&2
  else
    echo "Could not restore the previous image ${previous_image}." >&2
  fi
}

case "${BOTGE_CONTROL_ACTION}" in
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
    if [[ -n "${BOTGE_CONTROL_DIGEST}" ]]; then
      export BOTGE_IMAGE="mrewy/botge@${BOTGE_CONTROL_DIGEST}"
      # Older host Compose files must be upgraded before digest deployments are accepted.
      if ! configured_image=$(docker compose config --format json | jq -r '.services.botge.image') \
        || [[ "${configured_image}" != "${BOTGE_IMAGE}" ]]; then
        echo 'Compose must use BOTGE_IMAGE for the botge image.' >&2
        printf 'ERROR\n'
        exit 1
      fi
    fi
    if ! docker compose up -d --no-deps --pull always --wait --wait-timeout 120 botge >&2; then
      if [[ -n "${BOTGE_CONTROL_DIGEST}" ]]; then
        rollback
      fi
      printf 'ERROR\n'
      exit 1
    fi

    if [[ -n "${BOTGE_CONTROL_DIGEST}" ]]; then
      container=$(docker compose ps -q botge)
      if [[ -z "${container}" ]] \
        || ! running_image=$(docker inspect --format '{{.Config.Image}}' "${container}") \
        || ! health=$(docker inspect --format '{{.State.Health.Status}}' "${container}") \
        || [[ "${running_image}" != "${BOTGE_IMAGE}" || "${health}" != healthy ]]; then
        echo 'Running image or readiness does not match the approved candidate.' >&2
        rollback
        printf 'ERROR\n'
        exit 1
      fi
      umask 077
      image_file=$(mktemp "${BOTGE_DIR}/.botge-image.XXXXXX")
      trap 'rm -f -- "$image_file"' EXIT
      printf '%s\n' "${BOTGE_IMAGE}" > "${image_file}"
      mv -- "${image_file}" .botge-image
    fi
    # Retain previous images for rollback; prune only through deliberate operator maintenance.
    ;;

  *)
    printf 'DENIED\n'
    exit 1
    ;;
esac

printf 'OK\n'
