  .data[]
  | if .totals.branches.count == 0 then error("Rust branch coverage is missing.") else . end
  | [.files[] | .filename as $file | .summary | to_entries[]
     | select(.value.count > 0)
     | select(
         if .key == "branches" or .key == "lines" or .key == "functions" or .key == "regions"
         then .value.percent < 95
         else false end
       )
     | "\($file) \(.key): \(.value.percent)%"]
  | if length == 0 then "Every Rust file meets its coverage thresholds."
    else error(join("\n")) end
