#!/usr/bin/env bash
# 将扩展打包为 .crx / .zip 并输出到 dist/（见 --help）
#
# 依赖：bash、cp、find、node、zip；打 crx 另需 Chrome + ChromeExtPos 私钥。
# 不依赖 rsync（打包机可能无此命令）。扩展运行时文件须已在本仓库中
# （含 _locales/*/messages.json，由 scripts/build-locales.js 生成并提交）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  cat <<'EOF'
用法:
  ChromeExtPos=/path/to/key.pem bash scripts/pack-crx.sh          # 同时生成 crx + zip（默认）
  bash scripts/pack-crx.sh zip                                    # 仅 zip（上传 Chrome 插件中心）
  ChromeExtPos=/path/to/key.pem bash scripts/pack-crx.sh crx      # 仅 crx

可选:
  CHROME_BIN=/path/to/chrome  指定 Chrome 可执行文件（默认自动查找）
  FORMAT=zip|crx|both         与位置参数等价（位置参数优先）
EOF
}

FORMAT="${1:-${FORMAT:-both}}"
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

# 扩展运行时文件清单（须已在仓库中；打包机仅 cp，不跑 rsync / 不现场生成）
# 含 _locales：manifest default_locale 要求 locale 树，否则 Chrome 报
# 「Default locale was specified, but _locales subtree is missing」
PACK_PATHS=(
  manifest.json
  oauth-callback.html
  _locales
  background
  content
  devtools
  icons
  lib
  panel
  popup
)

for p in "${PACK_PATHS[@]}"; do
  if [[ ! -e "$ROOT/$p" ]]; then
    echo "错误: 仓库缺少打包所需路径: $p（须提前提交到本仓，勿依赖打包机生成）" >&2
    exit 1
  fi
done

if [[ ! -f "$ROOT/_locales/zh_CN/messages.json" ]]; then
  echo "错误: 缺少 _locales/zh_CN/messages.json（请在开发机运行 node scripts/build-locales.js 并提交）" >&2
  exit 1
fi

# 打包仅含扩展运行所需的文件（避免把测试、文档、密钥等打入产物）
# 用 cp -R：macOS / Linux 自带，不依赖 rsync
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
SRC="$STAGE/${BASE_NAME}"
mkdir -p "$SRC"
for p in "${PACK_PATHS[@]}"; do
  cp -R "$ROOT/$p" "$SRC/"
done
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
