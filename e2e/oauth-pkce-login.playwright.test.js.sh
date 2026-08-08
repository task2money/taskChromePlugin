#!/usr/bin/env bash
# 运行 OAuth2+PKCE 登录全链路 E2E（真实扩展 + 生产 OIDC）
# 需要完整 chromium 与显示服务器（无 DISPLAY 时自动 xvfb-run）
# 生产网络不可达时（CI 隔离）跳过；pre-commit 场景失败即退出。
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

# 生产 OIDC 不可达（CI 沙箱无外网）→ 跳过并告知；本地/有网环境必须真实执行
if ! curl -s -o /dev/null -m 8 "https://www.aidevpush.com/api/oidc/token" 2>/dev/null; then
  echo "oauth-pkce e2e: 生产 OIDC 不可达，跳过（本地开发请联网执行）。"
  exit 0
fi

if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a "$PW_BIN" test -c e2e/playwright.config.js e2e/oauth-pkce-login.playwright.test.js --timeout=180000
else
  "$PW_BIN" test -c e2e/playwright.config.js e2e/oauth-pkce-login.playwright.test.js --timeout=180000
fi
echo "oauth-pkce-login.playwright.test.js: OK"
