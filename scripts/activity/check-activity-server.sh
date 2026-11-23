#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
export GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=1

server=activity/server
reports=${PWD}/coverage/go
scratch=$(mktemp -d "${TMPDIR:-/tmp}/botge-server-check.XXXXXX")
trap 'rm -rf -- "${scratch}"' EXIT
mkdir -p "${reports}" "${scratch}/subprocess"
export BOTGE_GO_COVERDIR="${scratch}/subprocess"

(cd "${server}" && golangci-lint config verify)
for module in "${server}" "${server}/tools"; do
  go -C "${module}" mod tidy -diff
  go -C "${module}" mod verify
  (cd "${module}" && golangci-lint run ./...)
  go -C "${module}" vet -mod=readonly ./...
  go -C "${module}" fix -diff ./...
done
go -C "${server}" list -mod=readonly -f '{{range .GoFiles}}{{$.Dir}}/{{.}}{{"\n"}}{{end}}' ./... \
  > "${scratch}/sources.txt"
go -C "${server}/tools" test -mod=readonly ./fielddocs
go -C "${server}/tools" run -mod=readonly ./fielddocs < "${scratch}/sources.txt"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go -C "${server}" build -trimpath -mod=readonly \
  -o "${scratch}/activity-server" ./cmd/activity-server
go -C "${server}" list -deps -json -mod=readonly ./cmd/activity-server > "${scratch}/imports.json"
node --input-type=module - "${scratch}/imports.json" << 'JS'
import { readFileSync } from 'node:fs';
for (const object of readFileSync(process.argv[2], 'utf8').trim().split(/\n(?=\{)/u)) {
  const item = JSON.parse(object);
  if (!item.Standard && item.Module?.Path !== 'github.com/MrewyOrg/Botge/activity/server') {
    throw new Error(`Activity origin imports a non-standard dependency: ${item.ImportPath}`);
  }
}
JS

go -C "${server}" test -mod=readonly -race -shuffle=on -count=1 -covermode=atomic \
  -coverpkg=./... -coverprofile="${reports}/native.out" ./...
go tool covdata textfmt -i="${BOTGE_GO_COVERDIR}" -o="${reports}/subprocess.out"
checker_status=0
go -C "${server}/tools" tool go-test-coverage --source-dir "${PWD}/${server}" \
  --profile "${reports}/native.out,${reports}/subprocess.out" \
  --threshold-file 90 > "${reports}/report.txt" || checker_status=$?
cat "${reports}/report.txt"
if [ "${checker_status}" -ne 0 ]; then
  exit "${checker_status}"
fi
go -C "${server}/tools" tool govulncheck -C "${PWD}/${server}" ./...
go -C "${server}/tools" tool govulncheck -mode binary "${scratch}/activity-server"
