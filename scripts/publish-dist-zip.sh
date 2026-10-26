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
# 第二同步源 Gitee Release。约束 68 要求双端发布：无 remote / 无令牌（exit 3）
# 与显式跳过必须出现在摘要与退出码里，不能与「已发布」混为一谈
# （OPT-20261025-025）。退出码原样传播，SessionEnd 兜底据此保留 pending。
set +e
GITEE_OUT="$(bash "$ROOT/scripts/publish-gitee-release.sh")"
gitee_rc=$?
set -e
gitee_status="$(printf '%s\n' "$GITEE_OUT" \
  | sed -n 's/^GITEE_RELEASE_STATUS=//p' | tail -1)"
gitee_status="${gitee_status:-unknown}"
echo "publish-dist-zip: SUMMARY github=published gitee=${gitee_status} (gitee rc=${gitee_rc})" >&2
case "$gitee_status" in
  published) ;;
  published-tag-drift)
    echo "publish-dist-zip: WARN Gitee Release 已发布但 tag ref 未移动；按 tag 检出可能不是本次 zip" >&2
    ;;
  skipped-no-remote|skipped-no-token|skipped-mirror-behind)
    echo "publish-dist-zip: WARN 本次只在 GitHub 发布：$gitee_status" >&2
    echo "publish-dist-zip: WARN 修好 Gitee 配置后执行 bash scripts/ensure-gitee-mirror.sh --sync-https && bash scripts/publish-gitee-release.sh" >&2
    ;;
  skipped-explicit)
    echo "publish-dist-zip: note Gitee 腿被 TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1 显式跳过" >&2
    ;;
  failed)
    echo "publish-dist-zip: ERROR Gitee 发布失败；GitHub 侧已发布，见上方错误" >&2
    ;;
  *)
    echo "publish-dist-zip: ERROR Gitee 腿结果未知（rc=${gitee_rc}）" >&2
    ;;
esac
exit "$gitee_rc"
