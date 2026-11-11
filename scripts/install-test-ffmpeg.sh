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
    checksum=f95f189668268b8ec2c8acce6ea034cf36f93ba99a09f2654d0cfbd89c5c0ebd
    ;;
  Linux:aarch64)
    platform=linuxarm64
    checksum=52f5621dcac3466cda91b5a8be0403c748532050743851910fa4e654123981d1
    ;;
  *)
    printf '%s\n' 'The pinned FFmpeg installer supports Linux AMD64 and ARM64.' >&2
    exit 1
    ;;
esac

# Use matching tools with the animated WebP demuxer and encoder required by the Rust tests.
build="ffmpeg-n9.0.2-48-gd4070a14ce-${platform}-lgpl-9.0"
release=https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-09-12-42
directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT
archive="$directory/ffmpeg.tar.xz"

curl --fail --location --retry 3 --output "$archive" "$release/$build.tar.xz"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check
tar --extract --file "$archive" --directory "$directory" "$build/bin/ffmpeg" "$build/bin/ffprobe"
install -d -- "$1"
install -m 0755 -- "$directory/$build/bin/ffmpeg" "$directory/$build/bin/ffprobe" "$1"
