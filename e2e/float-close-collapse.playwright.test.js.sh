#!/usr/bin/env bash
# 运行浮窗 × 仅收起面板 E2E（Playwright）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PW_ROOT=""
if [ -d "$ROOT/node_modules/@playwright/test" ]; then
  PW_ROOT="$ROOT"
elif [ -d "$ROOT/../task2app/playwright/node_modules/@playwright/test" ]; then
  PW_ROOT="$ROOT/../task2app/playwright"
  export NODE_PATH="$PW_ROOT/node_modules${NODE_PATH:+:$NODE_PATH}"
elif [ -d "$ROOT/../AiDevGrafana/node_modules/@playwright/test" ]; then
  PW_ROOT="$ROOT/../AiDevGrafana"
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

# 已有缓存浏览器（含不匹配版本，config 会回退完整 chromium）则跳过下载
if ! ls "$HOME/.cache/ms-playwright"/chromium-* >/dev/null 2>&1; then
  "$PW_BIN" install chromium >/dev/null 2>&1 || true
fi

"$PW_BIN" test -c e2e/playwright.config.js e2e/float-close-collapse.playwright.test.js --timeout=60000
echo "float-close-collapse.playwright.test.js: OK"
