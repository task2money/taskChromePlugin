#!/usr/bin/env bash
# 将扩展打包为 .crx / .zip 并输出到 dist/（见 --help）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
用法:
  ChromeExtPos=/path/to/key.pem bash scripts/pack-crx.sh          # 仅 crx（默认）
  bash scripts/pack-crx.sh zip                                    # 仅 zip（上传 Chrome 插件中心）
  ChromeExtPos=/path/to/key.pem bash scripts/pack-crx.sh both     # 同时生成 crx + zip

可选:
  CHROME_BIN=/path/to/chrome  指定 Chrome 可执行文件（默认自动查找）
  FORMAT=zip|crx|both         与位置参数等价（位置参数优先）
EOF
}

FORMAT="${1:-${FORMAT:-crx}}"
case "$FORMAT" in
  crx|zip|both) ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "错误: 未知格式 '$FORMAT'（支持: crx | zip | both）" >&2
    usage >&2
    exit 1
    ;;
esac

NEED_CRX=0
NEED_ZIP=0
[[ "$FORMAT" == "crx" || "$FORMAT" == "both" ]] && NEED_CRX=1
[[ "$FORMAT" == "zip" || "$FORMAT" == "both" ]] && NEED_ZIP=1

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

KEY=""
CHROME=""
if [[ "$NEED_CRX" -eq 1 ]]; then
  KEY="${ChromeExtPos:-}"
  if [[ -z "$KEY" ]]; then
    echo "错误: 打包 crx 需设置环境变量 ChromeExtPos（应指向 .pem 私钥文件）" >&2
    exit 1
  fi
  KEY="${KEY/#\~/$HOME}"
  if [[ ! -f "$KEY" ]]; then
    echo "错误: 私钥文件不存在: $KEY" >&2
    exit 1
  fi
  CHROME="$(find_chrome)" || {
    echo "错误: 未找到 Chrome，可通过 CHROME_BIN 环境变量指定" >&2
    exit 1
  }
fi

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
BASE_NAME="task-chrome-plugin-v${VERSION}"
CRX_NAME="${BASE_NAME}.crx"
ZIP_NAME="${BASE_NAME}.zip"
DIST="$ROOT/dist"
mkdir -p "$DIST"

# 打包仅含扩展运行所需的文件（避免把测试、文档、密钥等打入产物）
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
SRC="$STAGE/${BASE_NAME}"
mkdir -p "$SRC"
rsync -a \
  --exclude='.DS_Store' \
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
find "$SRC" -name '.DS_Store' -delete

if [[ "$NEED_CRX" -eq 1 ]]; then
  echo "Chrome: $CHROME"
  echo "私钥:   $KEY"
  "$CHROME" --pack-extension="$SRC" --pack-extension-key="$KEY" >/dev/null

  if [[ ! -f "$SRC.crx" ]]; then
    echo "错误: 打包失败，未生成 crx" >&2
    exit 1
  fi
  mv -f "$SRC.crx" "$DIST/$CRX_NAME"
  echo "已生成: $DIST/$CRX_NAME"
fi

if [[ "$NEED_ZIP" -eq 1 ]]; then
  # Chrome Web Store：zip 根目录即为扩展文件（含 manifest.json）
  (cd "$SRC" && zip -r -X -q "$DIST/$ZIP_NAME" . -x '*.DS_Store' -x '*/.DS_Store')
  echo "已生成: $DIST/$ZIP_NAME"
fi
