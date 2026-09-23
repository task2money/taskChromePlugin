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
CRX_PRESENT=0
if [ -f "$CRX" ]; then
  ASSETS+=("$CRX")
  CRX_PRESENT=1
fi

# 本版要点来自上一发布 tag 到当前提交的说明，避免每次 Release 重复同一段历史文案。
TARGET="$(git rev-parse HEAD)"
NOTES="$(node "$ROOT/scripts/release-highlights.js" render \
  --tag "$TAG" \
  --repo "$REPO" \
  --crx "$CRX_PRESENT" \
  --rev "$TARGET")"
if [ -z "$NOTES" ]; then
  echo "publish-github-release: ERROR empty release notes" >&2
  exit 1
fi

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "publish-github-release: tag $TAG 已存在，上传/覆盖 assets..." >&2
  gh release upload "$TAG" "${ASSETS[@]}" -R "$REPO" --clobber
  # 更新说明（幂等）
  gh release edit "$TAG" -R "$REPO" --notes "$NOTES" >/dev/null
else
  # 新建 Release 前拒绝「与上一版同一提交」的空版本：版本号没有对应新变更时，
  # Releases 列表里读不出有没有新包（v1.8.75/v1.8.74 曾指向同一提交）。
  node "$ROOT/scripts/release-highlights.js" guard-same-commit \
    --tag "$TAG" \
    --repo "$REPO" \
    --rev "$TARGET" \
    --cwd "$ROOT"
  echo "publish-github-release: creating $TAG on $REPO @ $TARGET ..." >&2
  gh release create "$TAG" "${ASSETS[@]}" \
    -R "$REPO" \
    --target "$TARGET" \
    --title "$TAG" \
    --notes "$NOTES"
fi

URL="https://github.com/${REPO}/releases/tag/${TAG}"
echo "publish-github-release: OK $URL" >&2
