#!/usr/bin/env bash
# OPT-20260922-029：真实扩展 Popup Skill 登录门闩（未登录不发 prompt-skills / 登录后发且带 Authorization）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Playwright 不得继承 SOCKS 代理（ERR_PROXY_CONNECTION_FAILED）
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

TARGET="e2e/popup-prompt-skill-login-gate.playwright.test.js"
if [ -z "${DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
  xvfb-run -a "$PW_BIN" test -c e2e/playwright.config.js "$TARGET" --timeout=90000
else
  "$PW_BIN" test -c e2e/playwright.config.js "$TARGET" --timeout=90000
fi
echo "popup-prompt-skill-login-gate.playwright.test.js: OK"
