#!/usr/bin/env bats
load helpers

setup() {
  setup_stubs
  rm -rf "$REPO/ios"
  mkdir -p "$REPO/ios/Tools/bin" "$REPO/ios/"{BotgeTests,BotgeKitTests}
  export IOS="$REPO/scripts/ios/check-ios.sh"
}

ios_tools() {
  record xcodegen swiftformat swiftlint
  for tool in xcodegen swiftformat swiftlint; do
    ln -s "$STUBS/$tool" "$REPO/ios/Tools/bin/$tool"
  done
  stub xcodebuild << 'SH'
if [ "${XCODE_FAIL:-0}" = 1 ]; then
  echo 'Compiler failure fixture'
  exit 17
fi
SH
  stub xcrun << 'SH'
case "$*" in
  'llvm-cov export'*) printf '%s\n' "$SWIFT_COVERAGE" ;;
  'xcresulttool get test-results summary'*) echo 'Failing test fixture' ;;
  'xcresulttool get test-results tests'*) echo '{"testNodes":[{"nodeType":"Test Case","result":"Passed","name":"EmoteLinkTests"}]}' ;;
  'simctl list devices') printf '%s' "${LOCKDOWN_LIST:-}" ;;
  'simctl list runtimes') echo 'iOS 27.2 - com.apple.CoreSimulator.SimRuntime.iOS-27-2' ;;
  'simctl spawn '*' defaults read '*) echo "${LOCKDOWN_ENABLED:-0}" ;;
  'simctl launch '*) printf 'fixtures=%s\n' "${SIMCTL_CHILD_BOTGE_UI_TEST:-}" >> "$CALLS" ;;
esac
SH
  stub stat << 'SH'
[ "$1:$2" = '-f:%m %N' ]
shift 2
exec /usr/bin/stat -c '%Y %n' "$@"
SH
}

coverage_fixture() {
  local derived="$REPO/ios/DerivedData/Build"
  local products="$derived/Products/Debug-iphonesimulator"
  mkdir -p "$derived/ProfileData/run" "$products/BotgeKit.framework" \
    "$products/Botge.app/PlugIns/BotgeLiveActivity.appex"
  touch "$derived/ProfileData/run/Coverage.profdata" \
    "$products/BotgeKit.framework/BotgeKit" \
    "$products/Botge.app/Botge.debug.dylib" \
    "$products/Botge.app/PlugIns/BotgeLiveActivity.appex/BotgeLiveActivity.debug.dylib"
  export SWIFT_COVERAGE='{"data":[{"files":[{"filename":"/work/ios/Botge/Main.swift","summary":{"lines":{"count":10,"percent":90},"regions":{"count":10,"percent":90},"functions":{"count":10,"percent":90}}},{"filename":"/work/ios/BotgeLiveActivity/GuessLiveActivity.swift","summary":{"lines":{"count":2,"percent":0}}}]}]}'
}

@test "iOS reports a missing pinned tool and rejects unknown scopes" {
  run call_sh "$IOS"
  [ "$status" -eq 1 ]
  [[ "$output" == *'scripts/ios/setup-ios-tools.sh'* ]]
  ios_tools
  run call_sh "$IOS" unknown
  [ "$status" -eq 2 ]
  [[ "$output" == *'Scopes:'* ]]
  never_called 'xcodebuild '
}

@test "Swift lint forwards staged files and iOS static lint checks docs" {
  ios_tools
  stub python3 << 'SH'
[ "$PWD" = "$REPO/ios" ]
SH
  run call_sh "$REPO/scripts/ios/lint-swift.sh" '/tmp/Swift File.swift'
  [ "$status" -eq 0 ]
  called 'swiftlint lint --strict --quiet --force-exclude /tmp/Swift File.swift'
  run call_sh "$IOS"
  [ "$status" -eq 0 ]
  called 'python3 ../scripts/ios/check_swift_docs.py'
  run call_sh "$IOS" lint
  [ "$status" -eq 0 ]
  called 'swiftformat --lint .'
  run call_sh "$IOS" format
  [ "$status" -eq 0 ]
  called 'swiftformat .'
}

@test "iOS analysis uses a clean build and shows compiler failures" {
  ios_tools
  run call_sh "$IOS" analyze
  [ "$status" -eq 0 ]
  called 'xcodebuild clean build-for-testing'
  called '-derivedDataPath DerivedData/Analyze'
  called 'swiftlint analyze --strict --quiet --compiler-log-path DerivedData/analyze.log'
  : > "$CALLS"
  export XCODE_FAIL=1
  run call_sh "$IOS" analyze
  [ "$status" -eq 1 ]
  [[ "$output" == *'Compiler failure fixture'* ]]
  never_called 'swiftlint analyze'
}

@test "iOS tests require a profile and all coverage binaries, and gate each covered file" {
  ios_tools
  mkdir -p "$REPO/ios/DerivedData/Build/ProfileData"
  run call_sh "$IOS" test
  [ "$status" -eq 1 ]
  [[ "$output" == *'Missing iOS coverage profile'* ]]
  coverage_fixture
  binary="$REPO/ios/DerivedData/Build/Products/Debug-iphonesimulator/BotgeKit.framework/BotgeKit"
  rm "$binary"
  run call_sh "$IOS" test
  [ "$status" -eq 1 ]
  [[ "$output" == *'Missing DerivedData/Build/Products'* ]]
  touch "$binary"
  run call_sh "$IOS" test
  [ "$status" -eq 0 ]
  called 'xcrun llvm-cov export -summary-only'
  export SWIFT_COVERAGE="${SWIFT_COVERAGE//90/89}"
  run call_sh "$IOS" test
  [ "$status" -eq 1 ]
  [[ "$output" == *'Botge/Main.swift: regions 89%'* ]]
  [[ "$output" != *'GuessLiveActivity.swift:'* ]]
  export SWIFT_COVERAGE='{"data":[{"files":[]}]}'
  run call_sh "$IOS" test
  [ "$status" -ne 0 ]
  [[ "$output" == *'contains no source files'* ]]
}

@test "iOS CI analyzes instrumented products and reuses that build for testing" {
  ios_tools
  coverage_fixture
  run call_sh "$IOS" ci
  [ "$status" -eq 0 ]
  called 'xcodebuild clean build-for-testing -enableCodeCoverage YES'
  called 'xcodebuild test-without-building'
}

@test "Targeted iOS tests classify test suites and keep Xcode failures after summarizing" {
  ios_tools
  echo 'struct EmoteLinkTests {' > "$REPO/ios/BotgeTests/EmoteLinkTests.swift"
  run call_sh "$IOS" targeted
  [ "$status" -eq 2 ]
  [[ "$output" == *'Name at least one'* ]]
  export XCODE_FAIL=1
  run call_sh "$IOS" targeted EmoteLinkTests DiscoveryTests BotgeUITests BotgeUITests/Foo/testX
  [ "$status" -eq 17 ]
  [[ "$output" == *'Failing test fixture'* && "$output" == *'Passed  EmoteLinkTests'* ]]
  called '-only-testing:BotgeTests/EmoteLinkTests -only-testing:BotgeKitTests/DiscoveryTests'
  called '-only-testing:BotgeUITests/BotgeUITests -only-testing:BotgeUITests/Foo/testX'
}

@test "Lockdown tests create a simulator only when absent and enable the setting only when needed" {
  ios_tools
  run call_sh "$IOS" lockdown
  [ "$status" -eq 0 ]
  called 'simctl create iPhone 17e Lockdown'
  called 'defaults write -g LDMGlobalEnabled -bool true'
  called '-testPlan Lockdown'
  : > "$CALLS"
  export LOCKDOWN_LIST='iPhone 17e Lockdown (TEST-UUID)' LOCKDOWN_ENABLED=1
  run call_sh "$IOS" lockdown
  [ "$status" -eq 0 ]
  never_called 'simctl create'
  never_called 'defaults write'
}

@test "iOS launch passes the fixture flag only for fixture runs" {
  ios_tools
  stub PlistBuddy << 'SH'
echo 'test.botge.ios'
SH
  cp "$STUBS/PlistBuddy" "$BOTGE_TEST_ROOT/PlistBuddy"
  run call_sh "$IOS" run --fixtures
  [ "$status" -eq 0 ]
  called 'simctl install iPhone 17e'
  called 'simctl launch --terminate-running-process iPhone 17e test.botge.ios'
  grep -Fx 'fixtures=1' "$CALLS"
  run call_sh "$IOS" run
  [ "$status" -eq 0 ]
  grep -Fx 'fixtures=' "$CALLS"
}

@test "iOS tool setup checks the pinned products, rebuilds on a cache miss, and links versions" {
  lint_path="$REPO/ios/Tools/.build/artifacts/swiftlintplugins/SwiftLintBinary/SwiftLintBinary.artifactbundle/macos"
  release="$REPO/ios/Tools/.build/release"
  mkdir -p "$release" "$lint_path"
  export BOTGE_IOS_USE_CACHED_TOOLS=true
  export TEST_SWIFT_RELEASE="$release"
  stub swift << 'SH'
if [ "$*" = 'build --configuration release --show-bin-path' ]; then
  echo "$TEST_SWIFT_RELEASE"
fi
SH
  script="$REPO/scripts/ios/setup-ios-tools.sh"
  run call_sh "$script"
  [ "$status" -eq 1 ]
  [[ "$output" == *'pinned SwiftLint binary is missing'* ]]
  called 'swift package resolve --force-resolved-versions'
  called 'swift build --configuration release --product xcodegen'
  called 'swift build --configuration release --product swiftformat'
  for tool in xcodegen swiftformat swiftlint; do
    stub "$tool" << 'SH'
echo 'fixture-version'
SH
  done
  cp "$STUBS/xcodegen" "$STUBS/swiftformat" "$release/"
  cp "$STUBS/swiftlint" "$lint_path/"
  : > "$CALLS"
  run call_sh "$script"
  [ "$status" -eq 0 ]
  [[ "$output" == *'swiftlint fixture-version'* ]]
  never_called 'swift package resolve'
  [ "$(readlink "$REPO/ios/Tools/bin/swiftformat")" = "$release/swiftformat" ]
}
