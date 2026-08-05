#!/usr/bin/env bash
# 运行 DevTools 面板请求列表「刷新」链路测试（Playwright）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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

"$PW_BIN" test -c e2e/playwright.config.js e2e/panel-request-refresh.playwright.test.js --timeout=60000
echo "panel-request-refresh.playwright.test.js: OK"
