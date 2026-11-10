#!/bin/bash
set -eo pipefail

cd "$(dirname "$0")/.."

# Read .nvmrc and update the current symlink used by the Dev Container feature's PATH.
export NVM_SYMLINK_CURRENT=true
# shellcheck source=/dev/null
source "${NVM_DIR:?The Dev Container Node feature must provide NVM_DIR.}/nvm.sh" --no-use
nvm install
nvm alias default "$(nvm current)"

npm ci
# These tools back the optional workspace editor tasks.
npm install -g npm-check-updates sort-package-json @devcontainers/cli

sudo apt-get update
sudo apt-get install -y --no-install-recommends jq libopus-dev pkg-config shellcheck xz-utils

ffmpeg_bin=$(mktemp -d)
trap 'rm -rf "$ffmpeg_bin"' EXIT
sh scripts/install-test-ffmpeg.sh "$ffmpeg_bin"
sudo install -m 0755 "$ffmpeg_bin/ffmpeg" "$ffmpeg_bin/ffprobe" /usr/local/bin

rustup toolchain install --no-self-update
cargo fetch --locked
cargo install --locked --version 0.9.1 cargo-llvm-cov
