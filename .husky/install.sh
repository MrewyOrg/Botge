#!/bin/sh
set -eu

if [ "${NODE_ENV:-}" = production ] || [ "${CI:-}" = true ]; then
  exit 0
fi

exec husky
