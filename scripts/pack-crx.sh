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

# OPT-20261012-005: 一律按已提交的 HEAD 树打包。此前从工作区 cp，post-commit 触发
# 时会把尚未提交的改动打进指向上一提交的 Release（1.8.237 的未提交样式曾被注入
# 指向 1.8.236 的包），下载用户因此拿到作者本人都没提交的代码。
if ! git rev-parse --verify -q HEAD >/dev/null 2>&1; then
  echo "错误: 仓库没有 HEAD 提交，无法打包（请先提交扩展运行时文件）" >&2
  exit 1
fi

VERSION="$(git show HEAD:manifest.json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"
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
  sidepanel
)

# ── 运行时域名配置（SSOT: conf/base.yaml + conf/domain-history.yaml）──────────
# 扩展代码里不允许出现任何默认域名；发布包在打包期把域名写入
# lib/runtime-config.values.js。环境变量可显式覆盖（部署到不同域名时无需改码）。
#   PLUGIN_STORE_BUILD=1   商店构建：不内置任何域名，首次使用引导填写服务器地址
#   PLUGIN_GATEWAY_URL     服务器（API/主站）基址，未设置时取 Domain Contract baseOrigin
#   PLUGIN_SITE_URL        公共站点基址（闲置集市/提示词集市），默认 publicBaseUrl
#   PLUGIN_DOCS_URL        文档站基址，默认 ${scheme}://${subdomains.docs}
#   PLUGIN_LEGACY_HOSTS    旧域名 host 列表（逗号/空格分隔），默认取 domain-history 中
#                          status=active|grace|retired 且不是当前 baseDomain 的条目
#                          （grace 必须算进来：宽限期内已装扩展的用户仍保存着旧域名
#                          baseUrl，靠 legacyHosts 才会被自动迁到新网关）
PLUGIN_STORE_BUILD="${PLUGIN_STORE_BUILD:-0}"
GATEWAY_URL="${PLUGIN_GATEWAY_URL:-}"
SITE_URL="${PLUGIN_SITE_URL:-}"
DOCS_URL="${PLUGIN_DOCS_URL:-}"
LEGACY_HOSTS="${PLUGIN_LEGACY_HOSTS:-}"
CONTRACT_BASE_DOMAIN=""

contract_field() {
  # $1 = node 表达式（j 为 Domain Contract JSON）
  printf '%s' "$CONTRACT_JSON" | node -p "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); $1" 2>/dev/null || true
}

if [[ "$PLUGIN_STORE_BUILD" != "1" ]]; then
  CONF_READ="$ROOT/../runAll/scripts/conf-read.py"
  CONTRACT_JSON=""
  if [[ -f "$CONF_READ" ]] && command -v python3 >/dev/null 2>&1; then
    CONTRACT_JSON="$(python3 "$CONF_READ" domain-json 2>/dev/null || true)"
  fi
  if [[ -n "$CONTRACT_JSON" ]]; then
    CONTRACT_BASE_DOMAIN="$(contract_field 'j.baseDomain || ""')"
    [[ -n "$GATEWAY_URL" ]] || GATEWAY_URL="$(contract_field 'j.baseOrigin || ""')"
    [[ -n "$SITE_URL" ]] || SITE_URL="$(contract_field 'j.publicBaseUrl || ""')"
    [[ -n "$DOCS_URL" ]] || DOCS_URL="$(contract_field '(j.subdomains && j.subdomains.docs) ? ((j.scheme||"https") + "://" + j.subdomains.docs) : ""')"
  fi
  if [[ -z "$LEGACY_HOSTS" ]]; then
    HISTORY="$ROOT/../conf/domain-history.yaml"
    HISTORY_LOCAL="$ROOT/../conf-local/domain-history.yaml"
    if [[ -f "$HISTORY" ]] && command -v python3 >/dev/null 2>&1; then
      LEGACY_HOSTS="$(python3 - "$HISTORY" "$HISTORY_LOCAL" "$CONTRACT_BASE_DOMAIN" <<'PY'
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit(0)

def load(path):
    p = Path(path)
    if not p.is_file():
        return {}
    return yaml.safe_load(p.read_text(encoding="utf-8")) or {}

entries = {}
for path in sys.argv[1:3]:
    for item in (load(path).get("domains") or []):
        name = str(item.get("domain") or "").strip().lower()
        if name:
            entries[name] = item
current = str(sys.argv[3] if len(sys.argv) > 3 else "").strip().lower()
# grace 不能漏：切域后旧域进入宽限期但仍在服务，已装扩展的用户保存的 baseUrl
# 仍是旧域名；只有旧域名在 legacyHosts 里，storage.getApiConfig 才会把它迁到新
# 网关。漏掉 grace 会让这批用户在宽限期内继续打旧域 API，退役后直接失效。
hosts = [d for d, item in entries.items()
         if d != current and str(item.get("status") or "") in ("active", "grace", "retired")]
print(" ".join(hosts))
PY
)"
    fi
  fi
  if [[ -z "$GATEWAY_URL" ]]; then
    echo "错误: 未配置扩展服务器地址：设置 PLUGIN_GATEWAY_URL，或提供 conf/base.yaml Domain Contract（BASE_DOMAIN / conf-local）" >&2
    exit 1
  fi
fi

validate_url() {
  local name="$1" value="$2"
  [[ -z "$value" ]] && return 0
  if [[ ! "$value" =~ ^https?://[^[:space:]\'\"]+$ ]]; then
    echo "错误: $name 不是合法的 http(s) 地址: $value" >&2
    exit 1
  fi
}
validate_url "PLUGIN_GATEWAY_URL" "$GATEWAY_URL"
validate_url "PLUGIN_SITE_URL" "$SITE_URL"
validate_url "PLUGIN_DOCS_URL" "$DOCS_URL"

# 存在性按 HEAD 树判定：打包只取已提交内容，不因工作区缺文件而误判「仓库缺少」。
for p in "${PACK_PATHS[@]}"; do
  if ! git cat-file -e "HEAD:$p" 2>/dev/null; then
    echo "错误: HEAD 中缺少打包所需路径: ${p}（须提前提交到本仓，勿依赖打包机生成）" >&2
    exit 1
  fi
done

if ! git cat-file -e "HEAD:_locales/zh_CN/messages.json" 2>/dev/null; then
  echo "错误: HEAD 中缺少 _locales/zh_CN/messages.json（请在开发机运行 node scripts/build-locales.js 并提交）" >&2
  exit 1
fi

# 工作区有未提交改动时明确告知「本次只打已提交树」，避免误以为改动进了包。
DIRTY_PACK="$(git status --porcelain -- "${PACK_PATHS[@]}" manifest.json 2>/dev/null || true)"
if [[ -n "$DIRTY_PACK" ]]; then
  echo "⚠ pack-crx: 工作区存在未提交改动，本次按 HEAD 已提交树打包（不含以下改动）：" >&2
  printf '%s\n' "$DIRTY_PACK" | sed 's/^/    /' >&2
fi

# 打包仅含扩展运行所需的文件（避免把测试、文档、密钥等打入产物）
# 用 cp -R：macOS / Linux 自带，不依赖 rsync
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
SRC="$STAGE/${BASE_NAME}"
mkdir -p "$SRC"
# 从 HEAD 的已提交树导出（不读工作区），保证产物与某个提交一一对应。
git archive --format=tar HEAD -- "${PACK_PATHS[@]}" | tar -x -C "$SRC"
find "$SRC" -name '.DS_Store' -delete

# 注入运行时域名配置（覆盖仓库内的空默认值；只在暂存目录写，不污染工作区）。
node - "$SRC/lib/runtime-config.values.js" "$GATEWAY_URL" "$SITE_URL" "$DOCS_URL" "$LEGACY_HOSTS" <<'NODE'
const [out, gateway, site, docs, legacy] = process.argv.slice(2);
const legacyHosts = [...new Set(
  String(legacy || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
)];
const cfg = {
  gatewayBaseUrl: gateway || '',
  siteBaseUrl: site || '',
  docsBaseUrl: docs || '',
  legacyHosts,
};
const body = '/** 打包期生成：域名 SSOT 为 conf/base.yaml；请勿手改。 */\n'
  + 'globalThis.__TASKPLUGIN_RUNTIME_CONFIG__ = ' + JSON.stringify(cfg, null, 2) + ';\n';
require('fs').writeFileSync(out, body);
NODE
echo "运行时域名: gateway=${GATEWAY_URL:-<empty>} site=${SITE_URL:-<empty>} docs=${DOCS_URL:-<empty>} legacy=${LEGACY_HOSTS:-<none>}" >&2

# side_panel.default_path 必须在包内，否则加载已解压扩展时报
# Side panel file path must exist.
SIDE_PATH="$(git show HEAD:manifest.json | node -p 'const m=JSON.parse(require("fs").readFileSync(0,"utf8")); (m.side_panel&&m.side_panel.default_path)||""')"
if [[ -n "$SIDE_PATH" && ! -f "$SRC/$SIDE_PATH" ]]; then
  echo "错误: 打包目录缺少 side_panel 页面: ${SIDE_PATH}（Chrome 会报 Side panel file path must exist）" >&2
  exit 1
fi

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
