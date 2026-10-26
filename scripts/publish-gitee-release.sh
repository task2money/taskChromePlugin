#!/usr/bin/env bash
# 将 dist/ 产物发布为 Gitee Release（tag = v${manifest.version}）。
# 由 publish-dist-zip.sh 在 GitHub Release 之后调用。
# 令牌：环境变量 GITEE_ACCESS_TOKEN，或 conf-local 叠加后的 token。
#
# 环境变量:
#   TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1  跳过
#
# 机器可读状态（stdout 最后一行，供 publish-dist-zip.sh 汇总）:
#   GITEE_RELEASE_STATUS=published             已发布
#   GITEE_RELEASE_STATUS=published-tag-drift   Release 已发布，但 tag ref 未能移动
#                                              （无 Gitee 推送权限）；按 tag 检出的树
#                                              可能与 zip 不一致，需人工 `git push gitee v<ver>`
#   GITEE_RELEASE_STATUS=skipped-explicit      显式跳过（TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1）
#   GITEE_RELEASE_STATUS=skipped-no-remote     没有 gitee remote（跑 scripts/ensure-gitee-mirror.sh）
#   GITEE_RELEASE_STATUS=skipped-no-token      没有令牌
#   GITEE_RELEASE_STATUS=failed                Gitee API 发布失败
#
# 退出码: 0 = 已发布或显式跳过；1 = 发布失败；3 = 配置缺失（no-remote / no-token）。
# 配置缺失单独一个码，便于调用方区分「没配」与「发失败」，同时不让 GitHub 侧已成功的
# 发布被当作整体失败重试。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

status() {
  printf 'GITEE_RELEASE_STATUS=%s\n' "$1"
}

if [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE:-0}" = "1" ] || [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE:-}" = "true" ]; then
  echo "publish-gitee-release: skipped (TASK_CHROME_PLUGIN_SKIP_GITEE_RELEASE=1)" >&2
  status skipped-explicit
  exit 0
fi

REMOTE_URL="$(git remote get-url gitee 2>/dev/null || true)"
if [ -z "$REMOTE_URL" ]; then
  # 约束 68 要求双端发布；静默跳过会让「已发布」只对一半渠道成立。
  echo "publish-gitee-release: SKIPPED: no gitee remote — the release exists on GitHub only." >&2
  echo "publish-gitee-release: fix: bash scripts/ensure-gitee-mirror.sh, then re-run this script." >&2
  status skipped-no-remote
  exit 3
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
  status skipped-no-token
  exit 3
fi

VERSION="$(node -p "require('./manifest.json').version")"
ZIP="$ROOT/dist/task-chrome-plugin-v${VERSION}.zip"
CRX="$ROOT/dist/task-chrome-plugin-v${VERSION}.crx"
TARGET="$(git rev-parse HEAD)"
# Bash 3.2 + set -u: "${arr[@]}" on an empty array aborts with "unbound
# variable". Every release without a .crx (all of them since v1.8.26) died on
# that line before reaching the API — the Gitee leg was failing silently at the
# shell level, not at the API. Use the ${arr[@]+"${arr[@]}"} idiom instead.
CRX_ARGS=()
if [ -f "$CRX" ]; then
  CRX_ARGS=(--crx "$CRX")
fi

# 发布脚本是开发机一次性调用，不跟随 shell 代理（与业务进程直连约定一致）。
if ! env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  node "$ROOT/scripts/gitee-release.js" publish \
  --owner "$OWNER" \
  --repo "$REPO" \
  --zip "$ZIP" \
  --rev "$TARGET" \
  --cwd "$ROOT" \
  ${CRX_ARGS[@]+"${CRX_ARGS[@]}"}; then
  status failed
  exit 1
fi

# OPT-20261012-006: Gitee 侧 Release 已存在时 API 只改 tag_name 与说明，不动 tag
# ref；标签若留在上一提交，按标签检出与下载的 zip 会不一致。发布后把该 tag 移到
# 本次提交（只动这一个 tag，不动 main）。标签不存在时脚本自身 no-op，交给创建路径。
#
# 这一步需要 Gitee 的 git 推送权限（SSH key / 凭据），与 API 令牌是两套凭据。
# 令牌能发布 Release 但推送被拒时，资产已上线，只有 tag ref 未移动：此时不能把
# 整个发布判为失败（GitHub 侧已成功，重跑也不会改变），改为响亮告警 + 专用状态。
TAG_DRIFT=0
if git remote get-url gitee >/dev/null 2>&1; then
  if ! bash "$ROOT/scripts/retarget-release-tag.sh" --remote gitee --tag "v${VERSION}" --target "$TARGET"; then
    TAG_DRIFT=1
    echo "publish-gitee-release: WARN gitee tag v${VERSION} 未移动（无推送权限？）。Release 资产已发布，但按 tag 检出的树可能不是本次 zip。" >&2
    echo "publish-gitee-release: WARN fix: 配置 Gitee 推送凭据后执行 git push --force gitee refs/tags/v${VERSION}" >&2
  fi
fi

if [ "$TAG_DRIFT" -eq 1 ]; then
  status published-tag-drift
else
  status published
fi
