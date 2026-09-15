#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PW_BIN="${PW_BIN:-npx playwright}"
$PW_BIN test -c e2e/playwright.config.js e2e/page-advisor-fill-panel.playwright.test.js --timeout=60000
echo "page-advisor-fill-panel.playwright.test.js: OK"
