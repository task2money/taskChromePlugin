#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test test/plugin-version.test.js
echo "plugin-version.test.js: OK"
