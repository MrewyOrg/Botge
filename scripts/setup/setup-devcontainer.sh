#!/bin/bash
set -eo pipefail

script_directory=$(dirname "$0")
cd "${script_directory}/../.."

# Read .nvmrc and update the current symlink used by the Dev Container feature's PATH.
export NVM_SYMLINK_CURRENT=true
# shellcheck source=/dev/null
source "${NVM_DIR:?The Dev Container Node feature must provide NVM_DIR.}/nvm.sh" --no-use
nvm install
node_version=$(nvm current)
nvm alias default "${node_version}"

npm ci

sudo apt-get update
sudo apt-get install -y --no-install-recommends jq libopus-dev pkg-config python3-venv shellcheck xz-utils

ffmpeg_bin=$(mktemp -d)
trap 'rm -rf "$ffmpeg_bin"' EXIT
# Bootstrap the pinned package manager in an isolated temporary environment.
python3 -m venv "${ffmpeg_bin}/uv-bootstrap"
uv_requirement=$(python3 -c 'import pathlib, tomllib; print(tomllib.loads(pathlib.Path("pyproject.toml").read_text())["tool"]["uv"]["required-version"])')
"${ffmpeg_bin}/uv-bootstrap/bin/python" -m pip install --disable-pip-version-check --no-deps "uv${uv_requirement}"
install -d "${HOME}/.local/bin"
install -m 0755 "${ffmpeg_bin}/uv-bootstrap/bin/uv" "${HOME}/.local/bin/uv"
export PATH="${HOME}/.local/bin:${PATH}"
uv sync --locked

sh scripts/rust/install-test-ffmpeg.sh "${ffmpeg_bin}"
sudo install -m 0755 "${ffmpeg_bin}/ffmpeg" "${ffmpeg_bin}/ffprobe" /usr/local/bin

rustup toolchain install --no-self-update
cargo fetch --locked
cargo install --locked --version 0.9.1 cargo-llvm-cov
