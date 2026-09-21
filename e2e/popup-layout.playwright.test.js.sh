#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PW_BIN="${PW_BIN:-npx playwright}"
CI=1 $PW_BIN test -c e2e/playwright.config.js e2e/popup-layout.playwright.test.js --timeout=60000
echo "popup-layout.playwright.test.js: OK"
