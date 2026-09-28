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
#   bash scripts/ensure-gitee-mirror.sh --no-pushurl  # 只补 remote，不加 pushurl
#
# 环境变量:
#   TASK_CHROME_PLUGIN_GITEE_URL          覆盖镜像 URL（自测用）
#   TASK_CHROME_PLUGIN_SKIP_GITEE_PUSHURL=1  不追加 origin 的第二条 pushurl
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
WANT_PUSHURL=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --sync) SYNC=1 ;;
    --no-pushurl) WANT_PUSHURL=0 ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
    echo "ensure-gitee-mirror: DRIFT remote gitee = $CURRENT_REMOTE（期望 $MIRROR_URL）" >&2
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
        echo "ensure-gitee-mirror: ERROR origin fetch 被指向 Gitee（$ORIGIN_FETCH）" >&2
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
        echo "ensure-gitee-mirror: MISSING origin push 目标（期望 $ORIGIN_FETCH + $MIRROR_URL）" >&2
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
      echo "ensure-gitee-mirror: ~ origin push → $ORIGIN_FETCH + $MIRROR_URL（一次 push 双写）" >&2
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
if [ "$SYNC" -eq 1 ]; then
  echo "ensure-gitee-mirror: pushing main + tags → gitee" >&2
  git push gitee main --tags
fi
