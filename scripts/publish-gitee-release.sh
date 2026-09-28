#!/usr/bin/env bash
# 将 dist/ 产物发布为 Gitee Release（tag = v${manifest.version}）。
# 由 publish-dist-zip.sh 在 GitHub Release 之后调用。
# 令牌：环境变量 GITEE_ACCESS_TOKEN，或 conf-local 叠加后的 token。
#
# 环境变量:
#   TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1  跳过
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE:-0}" = "1" ] || [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE:-}" = "true" ]; then
  echo "publish-gitee-release: skipped (TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1)" >&2
  exit 0
fi

REMOTE_URL="$(git remote get-url gitee 2>/dev/null || true)"
if [ -z "$REMOTE_URL" ]; then
  echo "publish-gitee-release: skipped (no gitee remote)" >&2
  exit 0
fi

PARSED="$(node -e 'const r=require("./scripts/gitee-release.js").parseGiteeRemote(process.argv[1]); if(!r) process.exit(2); process.stdout.write(r.owner+" "+r.repo)' "$REMOTE_URL" || true)"
if [ -z "$PARSED" ]; then
  echo "publish-gitee-release: ERROR cannot parse gitee remote" >&2
  exit 1
fi
OWNER="${PARSED%% *}"
REPO="${PARSED#* }"

if [ -z "${GITEE_ACCESS_TOKEN:-}" ]; then
  META="$(cd "$ROOT/.." && pwd)"
  CONF="$META/conf/chrome/task-chrome-plugin/config.yaml"
  if [ -f "$META/runAll/scripts/conf_local.py" ]; then
    GITEE_ACCESS_TOKEN="$(
      PYTHONPATH="$META/runAll/scripts${PYTHONPATH:+:$PYTHONPATH}" python3 - "$CONF" <<'PY'
import sys
from pathlib import Path
from conf_local import overlay_conf_file
data = overlay_conf_file(Path(sys.argv[1]))
token = data.get("token") if isinstance(data, dict) else ""
if not isinstance(token, str):
    token = ""
sys.stdout.write(token.strip())
PY
    )"
    export GITEE_ACCESS_TOKEN
  fi
fi

if [ -z "${GITEE_ACCESS_TOKEN:-}" ]; then
  echo "publish-gitee-release: ERROR 缺少 Gitee 私人令牌。写入 conf-local/chrome/task-chrome-plugin/config.yaml 的 token，或导出 GITEE_ACCESS_TOKEN（需要 projects 权限）" >&2
  exit 1
fi

VERSION="$(node -p "require('./manifest.json').version")"
ZIP="$ROOT/dist/task-chrome-plugin-v${VERSION}.zip"
CRX="$ROOT/dist/task-chrome-plugin-v${VERSION}.crx"
TARGET="$(git rev-parse HEAD)"
CRX_ARG=()
if [ -f "$CRX" ]; then
  CRX_ARG=(--crx "$CRX")
fi

# 发布脚本是开发机一次性调用，不跟随 shell 代理（与业务进程直连约定一致）。
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  node "$ROOT/scripts/gitee-release.js" publish \
  --owner "$OWNER" \
  --repo "$REPO" \
  --zip "$ZIP" \
  --rev "$TARGET" \
  --cwd "$ROOT" \
  "${CRX_ARG[@]}"
