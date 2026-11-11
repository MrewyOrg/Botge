#!/bin/bash
# cspell:words dbus subuid uidmap elif
set -euo pipefail

if ((EUID != 0)); then
  echo "Run with: sudo bash $0 <control-name>" >&2
  exit 1
fi

# Verify the operating system.
# shellcheck source=/dev/null
. /etc/os-release

if [[ "$ID" != debian || "$VERSION_ID" != 13 ]]; then
  echo 'This installer targets Debian 13.' >&2
  exit 1
fi

readonly DEBIAN_FRONTEND=noninteractive
export DEBIAN_FRONTEND

if (($# != 1)) || [[ ! "$1" =~ ^[a-z_][a-z0-9_-]{0,23}$ ]]; then
  echo "Usage: sudo bash $0 <control-name>" >&2
  echo 'Use 1-24 lowercase letters, digits, underscores, or hyphens; start with a letter or underscore.' >&2
  exit 1
fi

readonly BOTGE_CONTROL_NAME="$1"
BOTGE_DOWNLOAD_DIR="/opt/$BOTGE_CONTROL_NAME"
readonly BOTGE_SOURCE=https://raw.githubusercontent.com/MrewyOrg/Botge/main

apt-get update
apt-get install -y --no-upgrade \
  ca-certificates \
  curl \
  dbus-user-session \
  uidmap \
  socat \
  systemd-container

# Retain supporting files for future setup runs and teardown.
install -d -o root -g root -m 755 \
  "$BOTGE_DOWNLOAD_DIR/botge_control/bin" \
  "$BOTGE_DOWNLOAD_DIR/botge_control/systemd" \
  "$BOTGE_DOWNLOAD_DIR/scripts" \
  "$BOTGE_DOWNLOAD_DIR/nginx"
BOTGE_DOWNLOAD_DIR="$(realpath "$BOTGE_DOWNLOAD_DIR")"
readonly BOTGE_DOWNLOAD_DIR

for file in \
  botge_control/config.sh \
  botge_control/import_data.sh \
  botge_control/inspect.sh \
  botge_control/setup_docker.sh \
  botge_control/teardown.sh \
  botge_control/bin/botge_control.sh \
  botge_control/systemd/botge_control.socket \
  botge_control/systemd/botge_control@.service \
  scripts/botge-control.sh \
  compose.yaml \
  botge.example.config.jsonc \
  .env.example \
  nginx/botge-nginx.conf; do
  # Keep installed command paths and preserve local control configuration.
  destination="$BOTGE_DOWNLOAD_DIR/${file%.sh}"
  if [[ "$file" == botge_control/config.sh && -e "$destination" ]]; then
    continue
  fi

  curl --fail --silent --show-error --location \
    "$BOTGE_SOURCE/$file" --output "$destination.download"
  install -o root -g root -m 644 \
    "$destination.download" "$destination"
  rm -f "$destination.download"
done

if [[ "$(realpath "$0")" != "$BOTGE_DOWNLOAD_DIR/botge_control/setup" ]]; then
  install -o root -g root -m 755 "$(realpath "$0")" "$BOTGE_DOWNLOAD_DIR/botge_control/setup"
fi

cd "$BOTGE_DOWNLOAD_DIR"

# shellcheck source=botge_control/config.sh
source botge_control/config

# Refuse conflicting accounts before changing Docker services or packages.
verify_control_account() {
  if id "$BOTGE_CONTROL_USER" > /dev/null 2>&1; then
    if [[ "$(id -u "$BOTGE_CONTROL_USER")" != "$BOTGE_CONTROL_UID" ||
    "$(id -gn "$BOTGE_CONTROL_USER")" != "$BOTGE_CONTROL_USER" ||
    "$(getent passwd "$BOTGE_CONTROL_USER" | cut -d: -f6)" != "$BOTGE_CONTROL_USER_HOME" ]]; then

      echo "Existing $BOTGE_CONTROL_USER has an unexpected UID, group, or home." >&2
      return 1
    fi

    if id -nG "$BOTGE_CONTROL_USER" | tr ' ' '\n' | grep -qx docker; then
      echo "Remove $BOTGE_CONTROL_USER from the docker group." >&2
      return 1
    fi

  elif getent passwd "$BOTGE_CONTROL_UID" > /dev/null; then
    echo "UID $BOTGE_CONTROL_UID is already allocated." >&2
    return 1
  fi
}
verify_control_account

# Execute commands through the control user's systemd manager.
user_systemctl() {
  systemctl --user --machine="${BOTGE_CONTROL_USER}@.host" "$@"
}

# Render systemd unit templates.
render() {
  sed \
    -e "s|@BOTGE_CONTROL_NAME@|$BOTGE_CONTROL_NAME|g" \
    -e "s|@BOTGE_CONTROL_USER@|$BOTGE_CONTROL_USER|g" \
    -e "s|@BOTGE_CONTROL_GROUP@|$BOTGE_CONTROL_GROUP|g" \
    -e "s|@BOTGE_DIR@|$BOTGE_DIR|g" \
    -e "s|@BOTGE_RUNTIME_DIR@|$BOTGE_RUNTIME_DIR|g" \
    "$1"
}

# Install Docker packages.
bash botge_control/setup_docker

# Disable system-wide Docker.
systemctl disable --now docker.service docker.socket
rm -f /var/run/docker.sock

# Create the control user's primary group.
getent group "$BOTGE_CONTROL_USER" > /dev/null || groupadd "$BOTGE_CONTROL_USER"

# Create the control user.
if ! id "$BOTGE_CONTROL_USER" > /dev/null 2>&1; then
  if getent passwd "$BOTGE_CONTROL_UID" > /dev/null; then
    echo "UID $BOTGE_CONTROL_UID is already allocated." >&2
    exit 1
  fi

  # Allow useradd to allocate subordinate IDs automatically.
  touch /etc/subuid /etc/subgid

  useradd \
    --uid "$BOTGE_CONTROL_UID" \
    --gid "$BOTGE_CONTROL_USER" \
    --home-dir "$BOTGE_CONTROL_USER_HOME" \
    --create-home \
    --shell /bin/bash \
    "$BOTGE_CONTROL_USER"
fi

verify_control_account

# Create the socket access group.
getent group "$BOTGE_CONTROL_GROUP" > /dev/null || groupadd "$BOTGE_CONTROL_GROUP"

# Enable the control user's systemd manager.
loginctl enable-linger "$BOTGE_CONTROL_USER"
systemctl start "user@${BOTGE_CONTROL_UID}.service"

if [[ ! -d "$BOTGE_RUNTIME_DIR" || ! -S "$BOTGE_RUNTIME_DIR/bus" ]]; then
  echo "User systemd/D-Bus session unavailable: $BOTGE_RUNTIME_DIR" >&2
  exit 1
fi

# Install rootless Docker.
if [[ ! -f "$BOTGE_CONTROL_USER_HOME/.config/systemd/user/docker.service" ]]; then
  systemd-run \
    --user \
    --machine="${BOTGE_CONTROL_USER}@.host" \
    --wait \
    --collect \
    --pipe \
    -E "HOME=$BOTGE_CONTROL_USER_HOME" \
    -E "XDG_RUNTIME_DIR=$BOTGE_RUNTIME_DIR" \
    -E "DBUS_SESSION_BUS_ADDRESS=unix:path=$BOTGE_RUNTIME_DIR/bus" \
    /usr/bin/dockerd-rootless-setuptool.sh install
fi

# Enable rootless Docker.
user_systemctl daemon-reload
user_systemctl enable --now docker.service

# Verify the rootless Docker socket.
if [[ ! -S "$BOTGE_RUNTIME_DIR/docker.sock" ]]; then
  echo "Missing rootless Docker socket: $BOTGE_RUNTIME_DIR/docker.sock" >&2
  exit 1
fi

# Verify that Docker is actually rootless.
security_options="$(
  runuser -u "$BOTGE_CONTROL_USER" -- env \
    HOME="$BOTGE_CONTROL_USER_HOME" \
    XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR" \
    DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock" \
    docker info --format '{{json .SecurityOptions}}'
)"
readonly security_options

if [[ "$security_options" != *rootless* ]]; then
  echo 'Docker is not running in rootless mode.' >&2
  exit 1
fi

# Verify Docker Compose.
runuser -u "$BOTGE_CONTROL_USER" -- env \
  HOME="$BOTGE_CONTROL_USER_HOME" \
  XDG_RUNTIME_DIR="$BOTGE_RUNTIME_DIR" \
  DOCKER_HOST="unix://$BOTGE_RUNTIME_DIR/docker.sock" \
  docker compose version > /dev/null

echo 'Rootless Docker and Docker Compose verified.'

# Create the application directory.
install -d \
  -o "$BOTGE_CONTROL_USER" \
  -g "$BOTGE_CONTROL_USER" \
  -m 700 \
  "$BOTGE_DIR"

# Keep nginx configuration accessible to the control account.
install -d \
  -o "$BOTGE_CONTROL_USER" \
  -g "$BOTGE_CONTROL_USER" \
  -m 755 \
  "$BOTGE_DIR/nginx"

# Populate a fresh installation without overwriting production files on reruns.
install_application_file() {
  local -r source_file="$1" destination="$2" mode="$3"

  if [[ ! -e "$destination" ]]; then
    install -o "$BOTGE_CONTROL_USER" -g "$BOTGE_CONTROL_USER" -m "$mode" \
      "$source_file" "$destination"
  fi
}

install_application_file compose.yaml "$BOTGE_DIR/compose.yaml" 600
install_application_file botge.example.config.jsonc "$BOTGE_DIR/botge.config.json" 644
install_application_file .env.example "$BOTGE_DIR/.env" 600
install_application_file nginx/botge-nginx.conf "$BOTGE_DIR/nginx/botge-nginx.conf" 644

# Install systemd units.
render botge_control/systemd/botge_control.socket \
  > "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket"

render botge_control/systemd/botge_control@.service \
  > "/etc/systemd/system/${BOTGE_CONTROL_NAME}@.service"

chown root:root \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket" \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}@.service"

chmod 644 \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket" \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}@.service"

# Install the control handler.
install -o root -g root -m 755 \
  botge_control/bin/botge_control \
  "/usr/local/bin/${BOTGE_CONTROL_NAME}"

# Verify the installed handler and systemd configuration.
bash -n "/usr/local/bin/${BOTGE_CONTROL_NAME}"

systemd-analyze verify \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}.socket" \
  "/etc/systemd/system/${BOTGE_CONTROL_NAME}@.service"

# Activate the control socket.
systemctl daemon-reload
systemctl enable "${BOTGE_CONTROL_NAME}.socket"
systemctl restart "${BOTGE_CONTROL_NAME}.socket"

# Verify the final setup.
user_systemctl is-active --quiet docker.service
systemctl is-active --quiet "${BOTGE_CONTROL_NAME}.socket"

test -S "$BOTGE_RUNTIME_DIR/docker.sock"
test -S "/run/${BOTGE_CONTROL_NAME}.sock"

echo "${BOTGE_CONTROL_NAME} setup completed."
echo "Control socket: /run/${BOTGE_CONTROL_NAME}.sock"
echo "Grant trusted accounts membership in $BOTGE_CONTROL_GROUP as needed."
echo "Edit $BOTGE_DIR/.env and $BOTGE_DIR/botge.config.json before starting Botge."
echo "Downloaded setup and maintenance files: $BOTGE_DOWNLOAD_DIR"
