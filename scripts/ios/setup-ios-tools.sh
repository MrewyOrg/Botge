#!/bin/sh
set -eu

# Builds the iOS tools pinned by ios/Tools/Package.resolved and links them into ios/Tools/bin.
# Hooks, npm scripts, CI, and the editor call those links, so every run uses the same versions.

cd "$(dirname "$0")/../../ios/Tools"

release=${PWD}/.build/release
swiftlint=.build/artifacts/swiftlintplugins/SwiftLintBinary/SwiftLintBinary.artifactbundle/macos/swiftlint
# CI only opts in after an exact cache hit for the selected Xcode and locked package inputs.
if [ "${BOTGE_IOS_USE_CACHED_TOOLS:-false}" != true ] || [ ! -x "${release}/xcodegen" ] \
  || [ ! -x "${release}/swiftformat" ] || [ ! -x "${swiftlint}" ]; then
  swift package resolve --force-resolved-versions
  swift build --configuration release --product xcodegen
  swift build --configuration release --product swiftformat
  release=$(swift build --configuration release --show-bin-path)
fi

if [ ! -x "${swiftlint}" ]; then
  printf '%s\n' "The pinned SwiftLint binary is missing: ${swiftlint}" >&2
  exit 1
fi

mkdir -p bin
ln -sf "${release}/xcodegen" bin/xcodegen
ln -sf "${release}/swiftformat" bin/swiftformat
ln -sf "${PWD}/${swiftlint}" bin/swiftlint

for tool in xcodegen swiftformat swiftlint; do
  version=$("bin/${tool}" --version)
  printf '%s %s\n' "${tool}" "${version}"
done
