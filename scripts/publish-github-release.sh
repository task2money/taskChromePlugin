#!/usr/bin/env bash
# 将 dist/ 产物发布为 GitHub Release（tag = v${manifest.version}）。
# 由 publish-dist-zip.sh 在本地 zip 成功后调用；需 gh CLI 已登录且有 repo 写权限。
#
# 环境变量:
#   TASK_CHROME_PLUGIN_SKIP_GH_RELEASE=1  跳过（仅本地 zip）
#   TASK_CHROME_PLUGIN_GH_REPO=owner/repo 覆盖仓库（默认推算 origin）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${TASK_CHROME_PLUGIN_SKIP_GH_RELEASE:-0}" = "1" ] || [ "${TASK_CHROME_PLUGIN_SKIP_GH_RELEASE:-}" = "true" ]; then
  echo "publish-github-release: skipped (TASK_CHROME_PLUGIN_SKIP_GH_RELEASE=1)" >&2
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "publish-github-release: WARNING gh CLI 不可用，跳过 GitHub Release" >&2
  exit 0
fi

VERSION="$(node -p "require('./manifest.json').version")"
TAG="v${VERSION}"
ZIP="$ROOT/dist/task-chrome-plugin-v${VERSION}.zip"
CRX="$ROOT/dist/task-chrome-plugin-v${VERSION}.crx"

if [ ! -f "$ZIP" ]; then
  echo "publish-github-release: ERROR missing $ZIP（先跑 publish-dist-zip.sh）" >&2
  exit 1
fi

REPO="${TASK_CHROME_PLUGIN_GH_REPO:-}"
if [ -z "$REPO" ]; then
  origin="$(git remote get-url origin 2>/dev/null || true)"
  # git@github.com:owner/repo.git 或 https://github.com/owner/repo.git
  REPO="$(printf '%s' "$origin" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
fi
if [ -z "$REPO" ] || [[ "$REPO" != */* ]]; then
  echo "publish-github-release: ERROR cannot resolve GitHub repo from origin" >&2
  exit 1
fi

ASSETS=("$ZIP")
NOTES_EXTRA=""
if [ -f "$CRX" ]; then
  ASSETS+=("$CRX")
  NOTES_EXTRA=$'\n| `'"task-chrome-plugin-v${VERSION}.crx"'` | Chrome 扩展安装包 |'
else
  NOTES_EXTRA=$'\n\n> 本版本未附带 `.crx`（缺少 ChromeExtPos 私钥时仅发布 zip）。'
fi

NOTES="$(cat <<EOF
## 云端Coding: 自动创新助手 ${TAG}

Chrome 扩展编译产物。

### 本版要点

- 自动运行门禁双读 \`allow_auto_run\` / \`default_auto_run\`（与项目页「已启用」对齐）
- commit 后自动 pack + GitHub Release（ADR-0097 / 约束 68）

### 安装方式

**方式一（推荐，解压加载）**
1. 下载 \`task-chrome-plugin-v${VERSION}.zip\` 并解压
2. 打开 Chrome → \`chrome://extensions/\`
3. 启用「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压后的目录

**方式二（CRX）**
1. 下载 \`task-chrome-plugin-v${VERSION}.crx\`（若本版提供）
2. 打开 \`chrome://extensions/\`，启用开发者模式后拖入安装

### 资源

| 文件 | 说明 |
|------|------|
| \`task-chrome-plugin-v${VERSION}.zip\` | 解压后可直接「加载已解压的扩展程序」 |${NOTES_EXTRA}
EOF
)"

TARGET="$(git rev-parse HEAD)"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "publish-github-release: tag $TAG 已存在，上传/覆盖 assets..." >&2
  gh release upload "$TAG" "${ASSETS[@]}" -R "$REPO" --clobber
  # 更新说明（幂等）
  gh release edit "$TAG" -R "$REPO" --notes "$NOTES" >/dev/null
else
  echo "publish-github-release: creating $TAG on $REPO @ $TARGET ..." >&2
  gh release create "$TAG" "${ASSETS[@]}" \
    -R "$REPO" \
    --target "$TARGET" \
    --title "$TAG" \
    --notes "$NOTES"
fi

URL="https://github.com/${REPO}/releases/tag/${TAG}"
echo "publish-github-release: OK $URL" >&2
