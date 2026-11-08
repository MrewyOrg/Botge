#!/bin/bash
# cspell:words dpkg
set -euo pipefail

if ((EUID != 0)); then
  echo 'Run this script as root.' >&2
  exit 1
fi

# shellcheck source=/dev/null
. /etc/os-release

if [[ "$ID" != debian || "$VERSION_ID" != 13 ]]; then
  echo 'This installer targets Debian 13.' >&2
  exit 1
fi

readonly DEBIAN_FRONTEND=noninteractive
export DEBIAN_FRONTEND

# Remove conflicting Docker packages.
mapfile -t conflicting_packages < <(
  dpkg --get-selections \
    docker.io \
    docker-compose \
    docker-doc \
    docker-buildx \
    podman-docker \
    containerd \
    runc 2> /dev/null \
    | awk '$2 == "install" { print $1 }'
)
readonly -a conflicting_packages

if ((${#conflicting_packages[@]} > 0)); then
  apt-get remove -y "${conflicting_packages[@]}"
fi

# Configure Docker's official signing key.
apt-get update
apt-get install -y ca-certificates curl
install -d -m 0755 /etc/apt/keyrings
if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
  curl -fsSL \
    https://download.docker.com/linux/debian/gpg \
    -o /etc/apt/keyrings/docker.asc
fi
chmod a+r /etc/apt/keyrings/docker.asc

tee /etc/apt/sources.list.d/docker.sources << EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt-get update

# Install Docker Engine and Compose.
apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-compose-plugin

# Confirm the rootless setup tool is available.
if ! command -v dockerd-rootless-setuptool.sh > /dev/null 2>&1; then
  apt-get install -y --no-upgrade docker-ce-rootless-extras
fi

# Verify Docker installation.
docker --version
docker compose version
command -v dockerd-rootless-setuptool.sh > /dev/null

echo 'Docker installed successfully.'
