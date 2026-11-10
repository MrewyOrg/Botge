#!/bin/bash
# cspell:words pgrep
set -euo pipefail

if ((EUID != 0)); then
  echo 'Run with: sudo bash botge_control/teardown' >&2
  exit 1
fi

# shellcheck source=/dev/null
. /etc/os-release

if [[ "$ID" != debian || "$VERSION_ID" != 13 ]]; then
  echo 'This installer targets Debian 13.' >&2
  exit 1
fi

BOTGE_DOWNLOAD_DIR="$(dirname "$(realpath "$0")")/.."
readonly BOTGE_DOWNLOAD_DIR
cd "$BOTGE_DOWNLOAD_DIR"
BOTGE_CONTROL_NAME="$(basename "$PWD")"
readonly BOTGE_CONTROL_NAME

if [[ ! "$BOTGE_CONTROL_NAME" =~ ^[a-z_][a-z0-9_-]{0,23}$ ]]; then
  echo 'Run teardown from the saved /opt/<control-name>/botge_control directory.' >&2
  exit 1
fi

# shellcheck source=botge_control/config.sh
source botge_control/config

# Verify the account before deleting its home and application data.
if id "$BOTGE_CONTROL_USER" > /dev/null 2>&1; then
  if [[ "$(id -u "$BOTGE_CONTROL_USER")" != "$BOTGE_CONTROL_UID" ||
  "$(id -gn "$BOTGE_CONTROL_USER")" != "$BOTGE_CONTROL_USER" ||
  "$(getent passwd "$BOTGE_CONTROL_USER" | cut -d: -f6)" != "$BOTGE_CONTROL_USER_HOME" ]]; then
    echo "Existing $BOTGE_CONTROL_USER has an unexpected UID, group, or home." >&2
    exit 1
  fi
fi

echo "This will remove:"
echo "  - $BOTGE_CONTROL_NAME systemd socket and service"
echo "  - $BOTGE_CONTROL_USER and its home directory"
echo "  - Rootless Docker containers, images, and volumes owned by this user"
echo "  - $BOTGE_CONTROL_GROUP"
echo
echo "WARNING: Botge configuration, secrets, and database files will be deleted."
echo

read -r -p "Type DELETE to continue: " confirmation
readonly confirmation

if [[ "$confirmation" != DELETE ]]; then
  echo 'Uninstallation cancelled.'
  exit 1
fi

# Disable the control socket.
if [[ -f "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket" ]]; then
  systemctl disable --now "${BOTGE_CONTROL_NAME}.socket"
fi

# Stop any active control service instances.
while read -r unit _; do
  [[ -n "$unit" ]] || continue
  systemctl stop "$unit"
done < <(
  systemctl list-units --all --plain --no-legend \
    "${BOTGE_CONTROL_NAME}@*.service"
)

# Stop rootless Docker.
if id "$BOTGE_CONTROL_USER" > /dev/null 2>&1; then

  if systemctl is-active --quiet "user@${BOTGE_CONTROL_UID}.service"; then
    systemctl --user \
      --machine="${BOTGE_CONTROL_USER}@.host" \
      disable --now docker.service || true
  fi

  # Disable persistent user services.
  loginctl disable-linger "$BOTGE_CONTROL_USER"

  # Terminate the user's remaining session and services.
  if loginctl show-user "$BOTGE_CONTROL_USER" > /dev/null 2>&1; then
    loginctl terminate-user "$BOTGE_CONTROL_USER"
  fi

  # Ensure no processes remain before deleting the account.
  if pgrep -u "$BOTGE_CONTROL_USER" > /dev/null; then
    echo "Processes belonging to $BOTGE_CONTROL_USER are still running." >&2
    echo 'Stop them before continuing.' >&2
    exit 1
  fi

  # Remove the account, home directory, and rootless Docker data.
  userdel -r "$BOTGE_CONTROL_USER"
fi

# Remove the socket access group.
if getent group "$BOTGE_CONTROL_GROUP" > /dev/null; then
  groupdel "$BOTGE_CONTROL_GROUP"
fi

# Remove the primary group if it still exists.
if getent group "$BOTGE_CONTROL_USER" > /dev/null; then
  groupdel "$BOTGE_CONTROL_USER"
fi

# Remove installed systemd configuration.
rm -f \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket" \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}@.service"

# Remove the control handler.
rm -f "/usr/local/bin/${BOTGE_CONTROL_NAME}"

# Remove the old environment file if present.
rm -f "/etc/${BOTGE_CONTROL_NAME}.env"

# Reload systemd.
systemctl daemon-reload
systemctl reset-failed

echo "${BOTGE_CONTROL_NAME} uninstallation completed."
echo 'Docker packages and the Docker APT repository were preserved.'
