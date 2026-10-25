#!/usr/bin/env bash
# OPT-20261012-006: 发布时若目标 tag 已存在但指向旧提交，把该 tag 移到本次提交。
# 只强制更新这一个 tag ref，绝不移动任何分支。
#
# 背景：publish-github-release.sh 发现 tag 已存在时只上传附件并改说明，不改
# --target；v1.8.237 的标签曾留在上一提交 3832d97，样式修复在 89b97f5。按标签
# 检出的树与下载的 zip 因此不是同一棵。Gitee 侧同样只改 tag_name 不动 ref。
#
# 用法:
#   retarget-release-tag.sh --remote <name> --tag <v1.2.3> [--target <sha>] [--check]
#     --remote  远端名（origin / gitee / ...）
#     --tag     目标 tag（含 v 前缀）
#     --target  目标提交，默认 HEAD
#     --check   只比对不改动；漂移时 exit 1（供门禁/自测）
# 退出码: 0 = tag 已指向目标或被成功移动；1 = --check 下漂移或 ls-remote 失败；
#         2 = 参数错误。
set -euo pipefail

REMOTE=""
TAG=""
TARGET=""
CHECK=0

usage() {
  sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote) REMOTE="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "retarget-release-tag: 未知参数 $1" >&2; exit 2 ;;
  esac
done

if [ -z "$REMOTE" ] || [ -z "$TAG" ]; then
  echo "retarget-release-tag: 需要 --remote 与 --tag" >&2
  exit 2
fi

if [ -z "$TARGET" ]; then
  TARGET="$(git rev-parse HEAD)"
fi

# 远端 tag 当前指向的提交：注解 tag 用 ^{} 剥离到提交，轻量 tag 直接取 sha。
if ! REMOTE_REFS="$(git ls-remote "$REMOTE" "refs/tags/$TAG" "refs/tags/$TAG^{}" 2>/dev/null)"; then
  echo "retarget-release-tag: ERROR git ls-remote $REMOTE 失败（网络或远端不可达）" >&2
  exit 1
fi

if [ -z "$REMOTE_REFS" ]; then
  echo "retarget-release-tag: ${REMOTE} 上还没有 ${TAG}，交给创建路径" >&2
  exit 0
fi

PLAIN="$(printf '%s\n' "$REMOTE_REFS" | awk -v r="refs/tags/$TAG" '$2 == r { print $1 }')"
PEELED="$(printf '%s\n' "$REMOTE_REFS" | awk -v r="refs/tags/$TAG^{}" '$2 == r { print $1 }')"
CURRENT="${PEELED:-$PLAIN}"

if [ "$CURRENT" = "$TARGET" ]; then
  echo "retarget-release-tag: OK $REMOTE $TAG 已指向 ${TARGET:0:7}" >&2
  exit 0
fi

if [ "$CHECK" = "1" ]; then
  echo "retarget-release-tag: DRIFT $REMOTE $TAG 指向 ${CURRENT:0:7}，应为 ${TARGET:0:7}" >&2
  exit 1
fi

echo "retarget-release-tag: $REMOTE $TAG ${CURRENT:0:7} -> ${TARGET:0:7}" >&2
# 先推远端；推送失败时 set -e 中止，本地 tag 不动，两边保持一致。
git push "$REMOTE" "$TARGET:refs/tags/$TAG" --force

# 本地同名 tag 一并移到目标，避免同仓 `git tag --list` / rev-parse 仍读到旧提交
# （release-highlights.js 的上版对比就走本地 tag）。
if LOCAL_CUR="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null)"; then
  if [ "$LOCAL_CUR" != "$TARGET" ]; then
    git tag -f "$TAG" "$TARGET" >/dev/null
  fi
fi
