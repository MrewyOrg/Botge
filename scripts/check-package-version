#!/bin/bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ] || [ -z "$1" ]; then
  printf 'usage: %s <package-name> [command-name]\n' "$0" >&2
  exit 1
fi

readonly PACKAGE_NAME="$1"
readonly COMMAND_NAME="${2:-$1}"
readonly VERSION_PATTERN='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'

if ! command -v "$COMMAND_NAME" > /dev/null 2>&1; then
  printf '\033[0;31m%s is not installed\033[0m\n' "$COMMAND_NAME" >&2
  exit 1
fi

if ! command -v npm > /dev/null 2>&1; then
  printf '\033[0;31m%s is not installed\033[0m\n' npm >&2
  exit 1
fi

if ! LOCAL_VERSION="$("$COMMAND_NAME" --version | awk '{print $NF}')"; then
  printf '\033[0;31mFailed to read the version of %s\033[0m\n' "$COMMAND_NAME" >&2
  exit 1
fi

LOCAL_VERSION="${LOCAL_VERSION#v}"
readonly LOCAL_VERSION

if [[ ! "$LOCAL_VERSION" =~ $VERSION_PATTERN ]]; then
  printf '\033[0;31mUnrecognized version output from %s: %s\033[0m\n' "$COMMAND_NAME" "$LOCAL_VERSION" >&2
  exit 1
fi

if ! LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"; then
  printf '\033[0;31mFailed to read the latest version of %s\033[0m\n' "$PACKAGE_NAME" >&2
  exit 1
fi
readonly LATEST_VERSION

if [[ ! "$LATEST_VERSION" =~ $VERSION_PATTERN ]]; then
  printf '\033[0;31mUnrecognized registry version for %s: %s\033[0m\n' "$PACKAGE_NAME" "$LATEST_VERSION" >&2
  exit 1
fi

if [ "$LOCAL_VERSION" = "$LATEST_VERSION" ]; then
  printf '\033[0;32m%s is up to date (%s)\033[0m\n' "$PACKAGE_NAME" "$LOCAL_VERSION"
else
  printf '\033[0;31m%s is not up to date (local: %s, latest: %s)\033[0m\n' "$PACKAGE_NAME" "$LOCAL_VERSION" "$LATEST_VERSION"
fi
