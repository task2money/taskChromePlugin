#!/usr/bin/env bash
# 生成 dist/task-chrome-plugin-v${version}.zip（gitignore；供本机 Reload / 内部分发）。
# 由 .githooks/post-commit 与 meta SessionEnd pack 兜底调用。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${TASK_CHROME_PLUGIN_SKIP_PACK:-0}" = "1" ] || [ "${TASK_CHROME_PLUGIN_SKIP_PACK:-}" = "true" ]; then
  echo "publish-dist-zip: skipped (TASK_CHROME_PLUGIN_SKIP_PACK=1)" >&2
  exit 0
fi

bash "$ROOT/scripts/pack-crx.sh" zip

VERSION="$(node -p "require('$ROOT/manifest.json').version")"
ZIP="$ROOT/dist/task-chrome-plugin-v${VERSION}.zip"
if [ ! -f "$ZIP" ]; then
  echo "publish-dist-zip: ERROR missing $ZIP" >&2
  exit 1
fi

# 快速自检：zip 内 manifest 版本与源码一致，且含 allow_auto_run 双读门禁。
ZIP_VER="$(unzip -p "$ZIP" manifest.json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"
if [ "$ZIP_VER" != "$VERSION" ]; then
  echo "publish-dist-zip: ERROR zip manifest version $ZIP_VER != $VERSION" >&2
  exit 1
fi
if ! unzip -p "$ZIP" lib/project-auto-run-label.js | grep -q "allow_auto_run"; then
  echo "publish-dist-zip: ERROR zip missing allow_auto_run dual-read" >&2
  exit 1
fi
# 域名配置：发布包必须带打包期注入的网关地址；商店构建必须保持为空（不含默认域名）。
RUNTIME_CFG="$(unzip -p "$ZIP" lib/runtime-config.values.js 2>/dev/null || true)"
if [ "${PLUGIN_STORE_BUILD:-0}" = "1" ]; then
  if printf '%s' "$RUNTIME_CFG" | grep -q '"gatewayBaseUrl": "http'; then
    echo "publish-dist-zip: ERROR store build must not embed a default gateway" >&2
    exit 1
  fi
else
  if ! printf '%s' "$RUNTIME_CFG" | grep -q '"gatewayBaseUrl": "http'; then
    echo "publish-dist-zip: ERROR zip missing injected PLUGIN_GATEWAY_URL runtime config" >&2
    exit 1
  fi
fi
echo "publish-dist-zip: OK $ZIP version=$VERSION" >&2

# GitHub Release（zip；有 crx 则一并上传）— OPT-20260920-032 漏发 release 的补全
bash "$ROOT/scripts/publish-github-release.sh"
# 第二同步源 Gitee Release（无 gitee remote 时脚本内跳过）
bash "$ROOT/scripts/publish-gitee-release.sh"
