#!/usr/bin/env bash
# 运行 Popup 访问令牌登录 Playwright E2E
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 优先本仓 node_modules；否则复用 monorepo task2app/playwright 已装依赖（免重复下载）
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

# 浏览器缓存已存在时 install 很快；失败不阻断（可能已装）
"$PW_BIN" install chromium >/dev/null 2>&1 || true

"$PW_BIN" test -c e2e/playwright.config.js e2e/popup-token-login.playwright.test.js --timeout=60000
echo "popup-token-login.playwright.test.js: OK"
