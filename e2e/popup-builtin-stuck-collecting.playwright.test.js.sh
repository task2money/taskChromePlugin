#!/usr/bin/env bash
# Popup 内置模型：卡住采集中时刷新/下载须立刻改状态行
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY || true

PW_ROOT=""
if [ -d "$ROOT/node_modules/@playwright/test" ]; then
  PW_ROOT="$ROOT"
elif [ -d "$ROOT/../task2app/playwright/node_modules/@playwright/test" ]; then
  PW_ROOT="$ROOT/../task2app/playwright"
  export NODE_PATH="$PW_ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
else
  echo "Installing @playwright/test into taskChromePlugin..."
  npm install --no-fund --no-audit
  PW_ROOT="$ROOT"
fi

export CI="${CI:-1}"
export PRE_COMMIT="${PRE_COMMIT:-}"

PW_BIN="$PW_ROOT/node_modules/.bin/playwright"
if [ ! -x "$PW_BIN" ]; then
  echo "playwright binary missing at $PW_BIN" >&2
  exit 1
fi

"$PW_BIN" install chromium >/dev/null 2>&1 || true

if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a "$PW_BIN" test -c e2e/playwright.config.js e2e/popup-builtin-stuck-collecting.playwright.test.js --timeout=60000
else
  "$PW_BIN" test -c e2e/playwright.config.js e2e/popup-builtin-stuck-collecting.playwright.test.js --timeout=60000
fi
echo "popup-builtin-stuck-collecting.playwright.test.js: OK"
