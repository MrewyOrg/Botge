["BotgeLiveActivity/BotgeLiveActivityBundle.swift",
  "BotgeLiveActivity/GuessLiveActivity.swift"] as $exempt
| [.data[].files[]]
| if length == 0 then error("iOS coverage report contains no source files") else .[] end
| (.filename | sub(".*/ios/"; "")) as $file
| select($exempt | index($file) | not)
| .summary | to_entries[]
| select(.key == "lines" or .key == "regions" or .key == "functions")
| select(.value.count > 0 and .value.percent < $minimum)
| "\($file): \(.key) \(.value.percent | floor)%"
