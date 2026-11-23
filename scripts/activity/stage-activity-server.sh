#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."
export VITE_ENABLE_ACTIVITY_CATALOG=true VITE_ENABLE_ACTIVITY_ADDS=true
export VITE_ENABLE_ACTIVITY_SETTINGS=true VITE_ENABLE_ACTIVITY_GAME=true VITE_ENABLE_7TV_DISCOVERY=true
npm run build -w activity -- --manifest
node activity/scripts/stage-server-site.ts
