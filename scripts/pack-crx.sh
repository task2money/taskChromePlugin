#!/usr/bin/env bash
# 使用 $ChromeExtPos 环境变量指向的 .pem 私钥，将扩展打包为 .crx 并输出到 dist/
#
# 用法:
#   ChromeExtPos=/path/to/key.pem bash scripts/pack-crx.sh
#
# 可选:
#   CHROME_BIN=/path/to/chrome  指定 Chrome 可执行文件（默认自动查找）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KEY="${ChromeExtPos:-}"
if [[ -z "$KEY" ]]; then
  echo "错误: 未设置环境变量 ChromeExtPos（应指向 .pem 私钥文件）" >&2
  exit 1
fi
KEY="${KEY/#\~/$HOME}"
if [[ ! -f "$KEY" ]]; then
  echo "错误: 私钥文件不存在: $KEY" >&2
  exit 1
fi

find_chrome() {
  if [[ -n "${CHROME_BIN:-}" && -x "$CHROME_BIN" ]]; then
    echo "$CHROME_BIN"
    return 0
  fi
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  )
  local c
  for c in "${candidates[@]}"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  for c in google-chrome google-chrome-stable chromium chromium-browser chrome; do
    if command -v "$c" >/dev/null 2>&1; then
      command -v "$c"
      return 0
    fi
  done
  return 1
}

CHROME="$(find_chrome)" || {
  echo "错误: 未找到 Chrome，可通过 CHROME_BIN 环境变量指定" >&2
  exit 1
}

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
CRX_NAME="task-chrome-plugin-v${VERSION}.crx"
DIST="$ROOT/dist"
mkdir -p "$DIST"

# 打包仅含扩展运行所需的文件（避免把测试、文档、密钥等打入 crx）
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
SRC="$STAGE/${CRX_NAME%.crx}"
mkdir -p "$SRC"
rsync -a \
  manifest.json \
  oauth-callback.html \
  background \
  content \
  devtools \
  icons \
  lib \
  panel \
  popup \
  "$SRC/"

echo "Chrome: $CHROME"
echo "私钥:   $KEY"
"$CHROME" --pack-extension="$SRC" --pack-extension-key="$KEY" >/dev/null

if [[ ! -f "$SRC.crx" ]]; then
  echo "错误: 打包失败，未生成 crx" >&2
  exit 1
fi
mv -f "$SRC.crx" "$DIST/$CRX_NAME"

echo "已生成: $DIST/$CRX_NAME"
