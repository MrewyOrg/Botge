#!/bin/sh
set -eu

# Checks the iOS app with the tools pinned in ios/Tools (run scripts/setup-ios-tools.sh first).
#   static    SwiftFormat lint, strict SwiftLint and documentation tags (default)
#   format    rewrite Swift files with SwiftFormat
#   test      generate the project, run every test on a simulator, enforce 90% line coverage
#   lockdown  run Lockdown.xctestplan on the Lockdown simulator (created on first use)
#
# The iOS simulator has no Lockdown Mode switch. The Lockdown simulator sets the global
# LDMGlobalEnabled default that Lockdown Mode sets, which WebKit honours; check on a device too.

cd "$(dirname "$0")/../ios"

tools=Tools/bin
destination=${BOTGE_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17e,OS=27.2}
lockdown_device=${BOTGE_IOS_LOCKDOWN_DEVICE:-iPhone 17e Lockdown}
minimum_coverage=90

for tool in xcodegen swiftformat swiftlint; do
  if [ ! -x "${tools}/${tool}" ]; then
    printf '%s\n' "Missing ${tools}/${tool}; run sh scripts/setup-ios-tools.sh." >&2
    exit 1
  fi
done

run_tests() {
  plan=$1
  result=DerivedData/${plan}.xcresult
  "${tools}/xcodegen" --spec project.yml --quiet
  rm -rf "${result}"
  xcodebuild test \
    -project Botge.xcodeproj \
    -scheme Botge \
    -testPlan "${plan}" \
    -destination "${destination}" \
    -derivedDataPath DerivedData \
    -resultBundlePath "${result}" \
    -skipPackagePluginValidation \
    -skipMacroValidation \
    -enableCodeCoverage YES \
    -quiet
}

scope=${1:-static}
case "${scope}" in
  static)
    "${tools}/swiftformat" --lint .
    "${tools}/swiftlint" lint --strict --quiet
    python="${PWD%/ios}/.venv/bin/python"
    if [ ! -x "${python}" ]; then python=python3; fi
    "${python}" ../scripts/check_swift_docs.py
    ;;
  format)
    "${tools}/swiftformat" .
    ;;
  test)
    run_tests Botge
    # Every BotgeKit source file must reach the gate; SwiftUI views are covered by UI tests.
    xcrun xccov view --report --json DerivedData/Botge.xcresult \
      | jq -e --argjson minimum "${minimum_coverage}" '
        [.targets[] | select(.name | startswith("BotgeKit.framework")) | .files[]
          | select(.lineCoverage * 100 < $minimum)
          | "\(.name): \(.lineCoverage * 100 | floor)%"]
        | if length == 0 then true else (.[] | stderr) and false end
      ' > /dev/null
    ;;
  lockdown)
    if ! xcrun simctl list devices | grep -q "${lockdown_device} ("; then
      runtime=$(xcrun simctl list runtimes | sed -n 's/.* - \(com\.apple\.CoreSimulator\.SimRuntime\.iOS-27-[0-9-]*[0-9]\)$/\1/p' | tail -n 1)
      xcrun simctl create "${lockdown_device}" com.apple.CoreSimulator.SimDeviceType.iPhone-17e "${runtime}" > /dev/null
    fi
    xcrun simctl boot "${lockdown_device}" 2> /dev/null || true
    xcrun simctl bootstatus "${lockdown_device}" -b > /dev/null
    enabled=$(xcrun simctl spawn "${lockdown_device}" defaults read -g LDMGlobalEnabled 2> /dev/null || true)
    if [ "${enabled}" != 1 ]; then
      xcrun simctl spawn "${lockdown_device}" defaults write -g LDMGlobalEnabled -bool true
      xcrun simctl shutdown "${lockdown_device}"
      xcrun simctl boot "${lockdown_device}"
      xcrun simctl bootstatus "${lockdown_device}" -b > /dev/null
    fi
    destination="platform=iOS Simulator,name=${lockdown_device}"
    run_tests Lockdown
    ;;
  *)
    printf '%s\n' 'Usage: sh scripts/check-ios.sh [static|format|test|lockdown]' >&2
    exit 2
    ;;
esac
