#!/bin/sh
# cspell:words amd64 arm64 demuxer lgpl
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: install-test-ffmpeg.sh INSTALL_DIRECTORY' >&2
  exit 1
fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    platform=linux64
    checksum=416081d93cb6cdcac9fade4f76d94321964253860b85b80404b5b9fb38dc3499
    ;;
  Linux:aarch64)
    platform=linuxarm64
    checksum=e0ea66cc042994d33ff9d65ac50a8c71d1011132ec1f08ecef6495ab3df90e80
    ;;
  *)
    printf '%s\n' 'The pinned FFmpeg installer supports Linux AMD64 and ARM64.' >&2
    exit 1
    ;;
esac

# Use matching tools with the animated WebP demuxer and encoder required by the Rust tests.
build="ffmpeg-n9.0.2-57-gd838f9f9ae-${platform}-lgpl-9.0"
release=https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-12-15-40
directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT
archive="$directory/ffmpeg.tar.xz"

curl --fail --location --retry 3 --output "$archive" "$release/$build.tar.xz"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check
tar --extract --file "$archive" --directory "$directory" "$build/bin/ffmpeg" "$build/bin/ffprobe"
install -d -- "$1"
install -m 0755 -- "$directory/$build/bin/ffmpeg" "$directory/$build/bin/ffprobe" "$1"
