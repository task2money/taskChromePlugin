#!/usr/bin/env bash
# OPT-20261012-005: 上传 Release 附件前先删除同名旧 asset。
#
# 背景：gh release upload --clobber 在附件同名时返回 422，post-commit 只告警，
# 旧 zip 会留在 Release 上——用户下到的仍是上一版产物。这里改为「先删同名、
# 再上传」，同名冲突不再是错误。
#
# 用法:
#   publish-release-assets.sh --repo <owner/repo> --tag <v1.2.3> --asset <file> [--asset <file>...]
# 退出码: 0 成功；1 附件缺失 / gh 失败；2 参数错误。
set -euo pipefail

REPO=""
TAG=""
ASSETS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:-}"; shift 2 ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --asset) ASSETS+=("${2:-}"); shift 2 ;;
    -h|--help)
      sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "publish-release-assets: 未知参数 $1" >&2; exit 2 ;;
  esac
done

if [ -z "$REPO" ] || [ -z "$TAG" ] || [ "${#ASSETS[@]}" -eq 0 ]; then
  echo "publish-release-assets: 需要 --repo、--tag 与至少一个 --asset" >&2
  exit 2
fi

for f in "${ASSETS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "publish-release-assets: ERROR 附件不存在 $f" >&2
    exit 1
  fi
done

# 已有同名 asset 时先删掉：既避开 --clobber 的 422，也保证不会「上传失败但旧包还在」。
EXISTING="$(gh release view "$TAG" -R "$REPO" --json assets --jq '.assets[].name' 2>/dev/null || true)"
for f in "${ASSETS[@]}"; do
  name="$(basename "$f")"
  if [ -n "$EXISTING" ] && printf '%s\n' "$EXISTING" | grep -qxF "$name"; then
    echo "publish-release-assets: 删除同名旧 asset $name" >&2
    gh release delete-asset "$TAG" "$name" -R "$REPO" --yes
  fi
done

gh release upload "$TAG" "${ASSETS[@]}" -R "$REPO"
