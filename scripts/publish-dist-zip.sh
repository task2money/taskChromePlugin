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
echo "publish-dist-zip: OK $ZIP version=$VERSION" >&2

# GitHub Release（zip；有 crx 则一并上传）— OPT-20260920-032 漏发 release 的补全
bash "$ROOT/scripts/publish-github-release.sh"
