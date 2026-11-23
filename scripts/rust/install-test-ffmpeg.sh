#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: install-test-ffmpeg.sh INSTALL_DIRECTORY' >&2
  exit 1
fi

system=$(uname -s)
architecture=$(uname -m)
case "${system}:${architecture}" in
  Linux:x86_64)
    platform=linux64
    checksum=63648ca32d6f831b6829f60d9fef3c9745f4dc4ad33d9ddd98ba2b5bca87e9e3
    ;;
  Linux:aarch64)
    platform=linuxarm64
    checksum=5fb88bdc315e808b07a607bedcbcaf609408508295aa2afd4beed810af8878f9
    ;;
  *)
    printf '%s\n' 'The pinned FFmpeg installer supports Linux AMD64 and ARM64.' >&2
    exit 1
    ;;
esac

# Use matching tools with the animated WebP demuxer and encoder required by the Rust tests.
build="ffmpeg-n9.0.2-62-gac1c6e003f-${platform}-lgpl-9.0"
release=https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-23-12-43
directory=$(mktemp -d)
trap 'rm -rf "$directory"' EXIT
archive="${directory}/ffmpeg.tar.xz"

curl --fail --location --retry 3 --output "${archive}" "${release}/${build}.tar.xz"
printf '%s  %s\n' "${checksum}" "${archive}" | sha256sum --check
tar --extract --file "${archive}" --directory "${directory}" "${build}/bin/ffmpeg" "${build}/bin/ffprobe"
install -d -- "$1"
install -m 0755 -- "${directory}/${build}/bin/ffmpeg" "${directory}/${build}/bin/ffprobe" "$1"
