#!/bin/sh
set -eu

# Checks the iOS app with the tools pinned in ios/Tools (run scripts/ios/setup-ios-tools.sh first).
#   static    SwiftFormat lint, strict SwiftLint and documentation tags (default)
#   lint      SwiftFormat and SwiftLint checks without the Python documentation check
#   format    rewrite Swift files with SwiftFormat
#   analyze   clean-build every target and run SwiftLint's analyzer rules (unused declarations and
#             imports), which need the compiler's arguments
#   test      generate the project, run every test on a simulator, enforce 90% line, region and
#             function coverage in every Swift file
#   ci        analyze a clean instrumented build, then test that same build and check coverage
#   lockdown  run Lockdown.xctestplan on the Lockdown simulator (created on first use)
#   targeted  run only the named test suites or tests and print one result line per test, e.g.
#             targeted EmoteLinkTests DiscoveryUITests BotgeUITests/EmotesUITests/testX
#   run       build, install and launch the app on the simulator; --fixtures uses the UI-test
#             fixtures (signed in, no network) instead of the configured bot
#
# The iOS simulator has no Lockdown Mode switch. The Lockdown simulator sets the global
# LDMGlobalEnabled default that Lockdown Mode sets, which WebKit honours; check on a device too.

cd "$(dirname "$0")/../../ios"

tools=Tools/bin
destination=${BOTGE_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17e,OS=27.2}
lockdown_device=${BOTGE_IOS_LOCKDOWN_DEVICE:-iPhone 17e Lockdown}
minimum_coverage=90

for tool in xcodegen swiftformat swiftlint; do
  if [ ! -x "${tools}/${tool}" ]; then
    printf '%s\n' "Missing ${tools}/${tool}; run sh scripts/ios/setup-ios-tools.sh." >&2
    exit 1
  fi
done

# Usage: execute_tests ACTION PLAN [RESULT_NAME [xcodebuild arguments...]]
execute_tests() {
  action=$1
  shift
  plan=$1
  result=DerivedData/${2:-${plan}}.xcresult
  shift
  if [ $# -gt 0 ]; then shift; fi
  rm -rf "${result}"
  xcodebuild "${action}" "$@" \
    -project Botge.xcodeproj \
    -scheme Botge \
    -testPlan "${plan}" \
    -destination "${destination}" \
    -derivedDataPath DerivedData \
    -resultBundlePath "${result}" \
    -skipPackagePluginValidation \
    -skipMacroValidation \
    -enableCodeCoverage YES \
    -parallel-testing-enabled NO \
    -quiet || {
    status=$?
    # -quiet hides why a run failed; the result bundle names failed tests and runner crashes.
    printf '%s\n' "Test results (${result}):" >&2
    xcrun xcresulttool get test-results summary --path "${result}" --compact >&2 || true
    return "${status}"
  }
}

run_tests() {
  "${tools}/xcodegen" --spec project.yml --quiet
  execute_tests test "$@"
}

lint_swift() {
  "${tools}/swiftformat" --lint .
  "${tools}/swiftlint" lint --strict --quiet
}

analyze_build() {
  build_directory=$1
  shift
  "${tools}/xcodegen" --spec project.yml --quiet
  mkdir -p DerivedData
  log=DerivedData/analyze.log
  # SwiftLint needs every compiler invocation, even when the sources are already up to date.
  xcodebuild clean build-for-testing "$@" \
    -project Botge.xcodeproj \
    -scheme Botge \
    -testPlan Botge \
    -destination "${destination}" \
    -derivedDataPath "${build_directory}" \
    -skipPackagePluginValidation \
    -skipMacroValidation > "${log}" 2>&1 || {
    tail -n 120 "${log}" >&2
    return 1
  }
  "${tools}/swiftlint" analyze --strict --quiet --compiler-log-path "${log}"
}

# Fails unless every Swift file with executable code reaches the minimum line, region and function
# coverage, counted across the app, BotgeKit and the widget extension, so a file built into two
# targets counts once. Swift has no branch coverage; regions cover each branch arm and closure.
#
# Exempt: the widget extension's entry point and its ActivityKit wiring, which only the system
# runs; tests render every view they show (BotgeLiveActivity/GuessActivityViews.swift).
check_coverage() {
  # The newest profile, from the last test run; earlier runs leave theirs behind.
  profile=$(find DerivedData/Build/ProfileData -name Coverage.profdata -type f \
    -exec stat -f '%m %N' {} + | sort -rn | head -n 1 | cut -d ' ' -f 2-)
  if [ -z "${profile}" ]; then
    printf '%s\n' 'Missing iOS coverage profile; run the instrumented tests first.' >&2
    return 1
  fi
  products=DerivedData/Build/Products/Debug-iphonesimulator
  kit=${products}/BotgeKit.framework/BotgeKit
  app=${products}/Botge.app/Botge.debug.dylib
  widget=${products}/Botge.app/PlugIns/BotgeLiveActivity.appex/BotgeLiveActivity.debug.dylib
  for binary in "${kit}" "${app}" "${widget}"; do
    if [ ! -f "${binary}" ]; then
      printf '%s\n' "Missing ${binary}; run the tests first." >&2
      return 1
    fi
  done
  report=DerivedData/coverage-summary.json
  xcrun llvm-cov export -summary-only -instr-profile "${profile}" "${kit}" \
    -object "${app}" -object "${widget}" > "${report}" || return
  below=$(
    jq -r --argjson minimum "${minimum_coverage}" -f ../scripts/ios/coverage.jq "${report}"
  ) || return
  if [ -n "${below}" ]; then
    printf '%s\n' "Below ${minimum_coverage}% coverage:" "${below}" >&2
    return 1
  fi
}

# Prints "Passed|Failed|Skipped  name" for every test case in a result bundle.
summarize() {
  xcrun xcresulttool get test-results tests --path "$1" \
    | jq -r '.. | objects | select(.nodeType == "Test Case") | "\(.result)  \(.name)"'
}

scope=${1:-static}
if [ $# -gt 0 ]; then shift; fi
case "${scope}" in
  static)
    lint_swift
    python="${PWD%/ios}/.venv/bin/python"
    if [ ! -x "${python}" ]; then python=python3; fi
    "${python}" ../scripts/ios/check_swift_docs.py
    ;;
  lint)
    lint_swift
    ;;
  format)
    "${tools}/swiftformat" .
    ;;
  analyze)
    analyze_build DerivedData/Analyze
    ;;
  test)
    run_tests Botge
    check_coverage
    ;;
  ci)
    analyze_build DerivedData -enableCodeCoverage YES -parallel-testing-enabled NO
    execute_tests test-without-building Botge
    check_coverage
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
  targeted)
    if [ $# -eq 0 ]; then
      printf '%s\n' 'Name at least one test suite or test, e.g. targeted EmoteLinkTests' >&2
      exit 2
    fi
    count=$#
    for name in "$@"; do
      case "${name}" in
        */*) filter=${name} ;;
        *UITests) filter=BotgeUITests/${name} ;;
        *)
          if grep -qs "^struct ${name} " BotgeTests/*.swift; then
            filter=BotgeTests/${name}
          else
            filter=BotgeKitTests/${name}
          fi
          ;;
      esac
      set -- "$@" "-only-testing:${filter}"
    done
    shift "${count}"
    set +e
    run_tests Botge Targeted "$@"
    status=$?
    summarize DerivedData/Targeted.xcresult
    set -e
    exit "${status}"
    ;;
  run)
    "${tools}/xcodegen" --spec project.yml --quiet
    xcodebuild build \
      -project Botge.xcodeproj \
      -scheme Botge \
      -destination "${destination}" \
      -derivedDataPath DerivedData \
      -skipPackagePluginValidation \
      -skipMacroValidation \
      -quiet
    app=DerivedData/Build/Products/Debug-iphonesimulator/Botge.app
    device=${BOTGE_IOS_DEVICE:-iPhone 17e}
    bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${app}/Info.plist")
    # Parallel UI test runs shut the simulator down, so boot it whenever needed.
    xcrun simctl boot "${device}" 2> /dev/null || true
    xcrun simctl bootstatus "${device}" -b > /dev/null
    xcrun simctl install "${device}" "${app}"
    if [ "${1:-}" = --fixtures ]; then
      SIMCTL_CHILD_BOTGE_UI_TEST=1 xcrun simctl launch --terminate-running-process "${device}" \
        "${bundle}"
    else
      xcrun simctl launch --terminate-running-process "${device}" "${bundle}"
    fi
    ;;
  *)
    printf '%s\n' \
      'Usage: sh scripts/ios/check-ios.sh SCOPE' \
      'Scopes: static, lint, format, analyze, test, ci, lockdown, targeted TEST..., run [--fixtures]' \
      >&2
    exit 2
    ;;
esac
