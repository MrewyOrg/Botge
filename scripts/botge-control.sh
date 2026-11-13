#!/bin/bash
set -euo pipefail

if (($# < 1 || $# > 2)); then
  echo 'Usage: botge-control <up|stop|deploy> [sha256:digest]' >&2
  exit 1
fi
readonly BOTGE_CONTROL_ACTION="$1"
case "$BOTGE_CONTROL_ACTION" in
  up) BOTGE_CONTROL_REQUEST=UP ;;
  stop) BOTGE_CONTROL_REQUEST=STOP ;;
  deploy) BOTGE_CONTROL_REQUEST=DEPLOY ;;
  *)
    echo "Invalid action: $BOTGE_CONTROL_ACTION" >&2
    exit 1
    ;;
esac
if (($# == 2)); then
  if [[ "$BOTGE_CONTROL_ACTION" != deploy || ! "$2" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo 'Only deploy accepts a sha256 image digest.' >&2
    exit 1
  fi
  BOTGE_CONTROL_REQUEST+=" $2"
fi
readonly BOTGE_CONTROL_REQUEST
: "${BOTGE_CONTROL_SOCKET:?Set BOTGE_CONTROL_SOCKET to the control socket path.}"

# Keep the connection open after sending the command so the handler can reply after Compose exits.
if ! BOTGE_CONTROL_RESPONSE="$(
  printf '%s\n' "$BOTGE_CONTROL_REQUEST" \
    | socat -T 900 -t 5 STDIO,ignoreeof "UNIX-CONNECT:${BOTGE_CONTROL_SOCKET}"
)"; then
  echo 'Unable to communicate with the Botge control socket.' >&2
  exit 1
fi
readonly BOTGE_CONTROL_RESPONSE
if [[ "$BOTGE_CONTROL_RESPONSE" != OK ]]; then
  echo "Botge $BOTGE_CONTROL_ACTION failed: ${BOTGE_CONTROL_RESPONSE:-no response}." >&2
  exit 1
fi
echo "Botge $BOTGE_CONTROL_ACTION action successful."
