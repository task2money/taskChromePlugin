#!/usr/bin/env bash
# 保证本机的第二同步源 Gitee 配置齐全，可重复执行（OPT-20260928-006）。
#
# 背景：Gitee 镜像只写在本机 .git/config，换机器或重新克隆后会丢；日常 `git push`
# 只到 GitHub origin，Gitee 会再次落后。本脚本把「remote gitee 存在」和
# 「origin 的第二条 pushurl 指向 Gitee」两件事都做成幂等的配置动作：
#
#   - remote `gitee`      —— 显式推送与 Release 脚本（publish-gitee-release.sh）用
#   - origin 的 pushurl 列表 —— [GitHub fetch URL, Gitee 镜像]，一次 `git push` 双写
#
# 陷阱：设置 remote.origin.pushurl 会**取代**隐式的 fetch URL 作为推送目标，所以
# 只加一条 Gitee 会让 origin 从此只推 Gitee。本脚本始终把 GitHub fetch URL 留在
# pushurl 列表首位；不会改写 origin 的 fetch URL，也不改动 branch.main.remote=origin。
# Gitee 不可达时 `git push` 会报错（GitHub 侧通常已收到），需要临时静默可
# export TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL=1。
#
# 用法:
#   bash scripts/ensure-gitee-mirror.sh            # 幂等补齐配置
#   bash scripts/ensure-gitee-mirror.sh --check    # 只校验，缺失则 exit 1
#   bash scripts/ensure-gitee-mirror.sh --sync     # 补齐后再推 main 与全部 tag
#   bash scripts/ensure-gitee-mirror.sh --sync-https  # 走 HTTPS + 令牌推 main（无 SSH key 时；不挂 pushurl）
#   bash scripts/ensure-gitee-mirror.sh --no-pushurl  # 只补 remote，不加 pushurl
#
# 环境变量:
#   TASK_CHROME_PLUGIN_GITEE_URL          覆盖镜像 URL（自测用）
#   TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL=1  不追加 origin 的第二条 pushurl
#   GITEE_ACCESS_TOKEN                    --sync-https 用；缺省时读 conf-local 的 token
#                                         （经 GIT_ASKPASS 传给 git，不写入 remote 配置）
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "ensure-gitee-mirror: ERROR 不在任何 git 仓库内" >&2
  exit 1
fi
cd "$REPO_ROOT"

MIRROR_URL="${TASK_CHROME_PLUGIN_GITEE_URL:-git@gitee.com:ljy-ruandao/task-chrome-plugin}"
CHECK=0
SYNC=0
SYNC_HTTPS=0
WANT_PUSHURL=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --sync) SYNC=1 ;;
    # --sync-https 的前提就是「本机没有 Gitee SSH 凭据」，所以不再给 origin
    # 挂 SSH 镜像 pushurl——那会让之后每次 git push 都在 Gitee 腿失败。
    --sync-https) SYNC=1; SYNC_HTTPS=1; WANT_PUSHURL=0 ;;
    --no-pushurl) WANT_PUSHURL=0 ;;
    -h|--help)
      sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "ensure-gitee-mirror: ERROR 未知参数 $arg" >&2
      exit 2
      ;;
  esac
done
if [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL:-0}" = "1" ] \
  || [ "${TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL:-}" = "true" ]; then
  WANT_PUSHURL=0
fi

CHANGED=0
PROBLEMS=0

# ── 1) remote gitee ──────────────────────────────────────────────────────────
CURRENT_REMOTE="$(git remote get-url gitee 2>/dev/null || true)"
if [ -z "$CURRENT_REMOTE" ]; then
  if [ "$CHECK" -eq 1 ]; then
    echo "ensure-gitee-mirror: MISSING remote gitee ($MIRROR_URL)" >&2
    PROBLEMS=1
  else
    git remote add gitee "$MIRROR_URL"
    echo "ensure-gitee-mirror: + remote gitee → $MIRROR_URL" >&2
    CHANGED=1
  fi
elif [ "$CURRENT_REMOTE" != "$MIRROR_URL" ]; then
  if [ "$CHECK" -eq 1 ]; then
    echo "ensure-gitee-mirror: DRIFT remote gitee = ${CURRENT_REMOTE}（期望 ${MIRROR_URL}）" >&2
    PROBLEMS=1
  else
    git remote set-url gitee "$MIRROR_URL"
    git remote set-url --push gitee "$MIRROR_URL"
    echo "ensure-gitee-mirror: ~ remote gitee $CURRENT_REMOTE → $MIRROR_URL" >&2
    CHANGED=1
  fi
fi

# ── 2) origin 的 push 目标：GitHub（原 fetch URL）+ Gitee 镜像 ────────────────
# 注意：一旦设置了 remote.origin.pushurl，它就**取代**隐式的 fetch URL 作为推送目标。
# 所以只 append 一条 Gitee 会让 origin 从此只推 Gitee、GitHub 再也收不到——
# 必须把原 fetch URL 一并留在 pushurl 列表里（顺序：GitHub 在前，Gitee 在后）。
if [ "$WANT_PUSHURL" -eq 1 ]; then
  if ! git remote get-url origin >/dev/null 2>&1; then
    if [ "$CHECK" -eq 1 ]; then
      echo "ensure-gitee-mirror: MISSING remote origin（无法挂第二条 pushurl）" >&2
      PROBLEMS=1
    else
      echo "ensure-gitee-mirror: WARN 无 origin，跳过 pushurl（只保留 remote gitee）" >&2
    fi
  else
    ORIGIN_FETCH="$(git remote get-url origin)"
    case "$ORIGIN_FETCH" in
      *gitee.com*)
        echo "ensure-gitee-mirror: ERROR origin fetch 被指向 Gitee（${ORIGIN_FETCH}）" >&2
        PROBLEMS=1
        ;;
    esac

    CURRENT_PUSH="$(git config --get-all remote.origin.pushurl 2>/dev/null || true)"
    # 一条 pushurl 都没有时，先把 fetch URL 显式写进去，保住 GitHub 侧
    if [ -z "$CURRENT_PUSH" ]; then
      DESIRED_PUSH="$ORIGIN_FETCH"
    else
      DESIRED_PUSH="$CURRENT_PUSH"
    fi
    if ! printf '%s\n' "$DESIRED_PUSH" | grep -qxF "$MIRROR_URL"; then
      DESIRED_PUSH="$DESIRED_PUSH
$MIRROR_URL"
    fi
    # 列表里必须至少留一条非镜像目标，否则 push 到不了 GitHub
    if ! printf '%s\n' "$DESIRED_PUSH" | grep -vxF "$MIRROR_URL" | grep -q .; then
      DESIRED_PUSH="$ORIGIN_FETCH
$DESIRED_PUSH"
    fi

    if [ "$CHECK" -eq 1 ]; then
      if [ "$CURRENT_PUSH" != "$DESIRED_PUSH" ]; then
        echo "ensure-gitee-mirror: MISSING origin push 目标（期望 ${ORIGIN_FETCH} + ${MIRROR_URL}）" >&2
        PROBLEMS=1
      fi
      # 危险态：pushurl 里只有镜像，GitHub 已经收不到 push
      if printf '%s\n' "$CURRENT_PUSH" | grep -qxF "$MIRROR_URL" \
        && ! printf '%s\n' "$CURRENT_PUSH" | grep -qxF "$ORIGIN_FETCH"; then
        echo "ensure-gitee-mirror: ERROR pushurl 只含 Gitee，origin 将推不到 GitHub（$ORIGIN_FETCH 缺失）" >&2
        PROBLEMS=1
      fi
    elif [ "$CURRENT_PUSH" != "$DESIRED_PUSH" ]; then
      git config --unset-all remote.origin.pushurl 2>/dev/null || true
      while IFS= read -r url; do
        [ -z "$url" ] && continue
        git config --add remote.origin.pushurl "$url"
      done <<< "$DESIRED_PUSH"
      echo "ensure-gitee-mirror: ~ origin push → ${ORIGIN_FETCH} + ${MIRROR_URL}（一次 push 双写）" >&2
      CHANGED=1
    fi
  fi
fi

if [ "$CHECK" -eq 1 ]; then
  if [ "$PROBLEMS" -ne 0 ]; then
    echo "ensure-gitee-mirror: 配置不完整，请运行 bash scripts/ensure-gitee-mirror.sh" >&2
    exit 1
  fi
  echo "ensure-gitee-mirror: OK" >&2
  exit 0
fi

if [ "$CHANGED" -eq 0 ]; then
  echo "ensure-gitee-mirror: 已是最新，无需改动" >&2
fi

# ── 3) 可选：把当前 refs 补推到 Gitee ────────────────────────────────────────
# --sync-https：本机没有 Gitee SSH key 时，用 conf-local 的令牌走 HTTPS。
# 令牌只经 GIT_ASKPASS 传给 git（临时文件 0700、退出即删），不写进 remote
# 配置、不出现在 argv 里。只推 main：tag 由 Release 流程按 target_commitish
# 创建，重复推已有 tag 只会得到一堆 non-fast-forward。
gitee_token() {
  [ -n "${GITEE_ACCESS_TOKEN:-}" ] && return 0
  local meta conf
  meta="$(cd "$REPO_ROOT/.." && pwd)"
  conf="$meta/conf/chrome/task-chrome-plugin/config.yaml"
  if [ -f "$meta/runAll/scripts/conf_local.py" ] && [ -f "$conf" ]; then
    GITEE_ACCESS_TOKEN="$(
      PYTHONPATH="$meta/runAll/scripts${PYTHONPATH:+:$PYTHONPATH}" python3 - "$conf" <<'PY'
import sys
from pathlib import Path
from conf_local import overlay_conf_file
data = overlay_conf_file(Path(sys.argv[1]))
token = data.get("token") if isinstance(data, dict) else ""
sys.stdout.write(token.strip() if isinstance(token, str) else "")
PY
    )"
    export GITEE_ACCESS_TOKEN
  fi
}

sync_https() {
  local rest owner repo askpass
  case "$MIRROR_URL" in
    git@gitee.com:*) rest="${MIRROR_URL#git@gitee.com:}" ;;
    https://gitee.com/*) rest="${MIRROR_URL#https://gitee.com/}" ;;
    *)
      echo "ensure-gitee-mirror: ERROR --sync-https 只支持 gitee.com 镜像地址（${MIRROR_URL}）" >&2
      return 1
      ;;
  esac
  rest="${rest%.git}"
  owner="${rest%%/*}"
  repo="${rest#*/}"
  gitee_token
  if [ -z "${GITEE_ACCESS_TOKEN:-}" ]; then
    echo "ensure-gitee-mirror: ERROR 缺少 Gitee 令牌（导出 GITEE_ACCESS_TOKEN，或写 conf-local/chrome/task-chrome-plugin/config.yaml 的 token）" >&2
    return 1
  fi
  askpass="$(mktemp "${TMPDIR:-/tmp}/gitee-askpass.XXXXXX")"
  chmod 700 "$askpass"
  # shellcheck disable=SC2064
  trap "rm -f '$askpass'" EXIT
  cat > "$askpass" <<SH
#!/bin/sh
case "\$1" in
  Username*) echo "$owner" ;;
  Password*) printf '%s' "\${GITEE_ACCESS_TOKEN:-}" ;;
esac
SH
  echo "ensure-gitee-mirror: pushing main → https://gitee.com/${owner}/${repo}（令牌经 GIT_ASKPASS）" >&2
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 \
    git -c http.proxy= -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 \
    push "https://gitee.com/$owner/$repo.git" main
}

if [ "$SYNC" -eq 1 ]; then
  if [ "$SYNC_HTTPS" -eq 1 ]; then
    sync_https
  else
    echo "ensure-gitee-mirror: pushing main + tags → gitee" >&2
    git push gitee main --tags
  fi
fi
