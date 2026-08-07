#!/usr/bin/env bash
# 运行真实扩展消息通道 + panel 消息管道回归测试（Playwright）
# 需要完整 chromium 与显示服务器（无 DISPLAY 时自动 xvfb-run）
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

# 真实扩展加载必须 headless: false（完整 chromium），无显示服务器时用 xvfb-run
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a "$PW_BIN" test -c e2e/playwright.config.js e2e/real-extension-messaging.playwright.test.js --timeout=120000
else
  "$PW_BIN" test -c e2e/playwright.config.js e2e/real-extension-messaging.playwright.test.js --timeout=120000
fi
echo "real-extension-messaging.playwright.test.js: OK"
