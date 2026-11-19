#!/bin/sh
set -eu

# Checks the iOS app with the tools pinned in ios/Tools (run scripts/setup-ios-tools.sh first).
#   static    SwiftFormat lint and strict SwiftLint (default)
#   format    rewrite Swift files with SwiftFormat
#   test      generate the project, run every test on a simulator, enforce 90% line coverage
#   lockdown  run Lockdown.xctestplan on a simulator with Lockdown Mode turned on

cd "$(dirname "$0")/../ios"

tools=Tools/bin
destination=${BOTGE_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17e,OS=27.2}
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
    run_tests Lockdown
    ;;
  *)
    printf '%s\n' 'Usage: sh scripts/check-ios.sh [static|format|test|lockdown]' >&2
    exit 2
    ;;
esac
