#!/bin/bash
# cspell:words ltrimstr
set -euo pipefail

# Run explicitly on the host. The bot is stopped briefly for a consistent redb copy.
if (($# != 1)); then
  echo 'Usage: backup-compose.sh <new-backup-directory>' >&2
  exit 1
fi
backup_dir=$(realpath -m "$1")
if [[ -e "$backup_dir" ]]; then
  echo 'Choose a new backup directory; existing backups are never overwritten.' >&2
  exit 1
fi
cd "${BOTGE_DIR:?Set BOTGE_DIR to the installation directory.}"
if [[ -f .botge-image ]]; then
  BOTGE_IMAGE=$(cat .botge-image)
  [[ "$BOTGE_IMAGE" =~ ^mrewy/botge@sha256:[a-f0-9]{64}$ ]]
  export BOTGE_IMAGE
fi
exec 9> "${BOTGE_CONTROL_LOCK:?Set the same lock used by the control handler.}"
flock -n 9 || {
  echo 'Another deployment or import is active.' >&2
  exit 1
}
container=$(docker compose ps -q --status running botge)
[[ -n "$container" ]] || {
  echo 'Botge must be running before this backup operation.' >&2
  exit 1
}
# Inspect the running container, not a possibly changed Compose file or host environment.
if ! docker inspect --format '{{json .Config}}' "$container" | jq --exit-status '
  (.Env // [] | map(select(startswith("BOTGE_DATA_DIR="))) | last // "BOTGE_DATA_DIR=data"
    | ltrimstr("BOTGE_DATA_DIR=")) as $data |
  ($data == "/app/data" or $data == "/app/data/" or
    ((.WorkingDir == "/app") and (["data", "data/", "./data", "./data/"] | index($data) != null)))
' > /dev/null; then
  echo 'Backup requires the running database directory to be /app/data. Botge was not stopped.' >&2
  exit 1
fi
image=$(docker inspect --format '{{.Image}}' "$container")
umask 077
mkdir "$backup_dir"
# Restart the original container, rather than recreating it against a potentially changed tag.
trap 'docker compose start --wait --wait-timeout 120 botge >&2' EXIT
docker compose stop --timeout 60 botge
docker cp "$container:/app/data/botge.redb" "$backup_dir/botge.redb"
docker run --rm --network none --read-only --cap-drop ALL --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$backup_dir/botge.redb,dst=/backup.redb,readonly" \
  --entrypoint /app/botge "$image" --verify-database /backup.redb
printf '%s\n' "$image" > "$backup_dir/image-id"
(cd "$backup_dir" && sha256sum botge.redb > SHA256SUMS)
echo "Verified offline backup: $backup_dir"
