#!/usr/bin/env bash
# OPT-20261026-007: gh 的 keyring token 可能已失效，而 git 的 credential
# helper（macOS osxkeychain / libsecret）里仍有可用 token。发布链路在 gh
# 默认凭据失败时借用 git credential 的 password，仅在当前进程导出
# GH_TOKEN，不落盘、不修改 gh 配置。
#
# 用法: source scripts/gh-auth.sh; ensure_gh_auth

ensure_gh_auth() {
  if gh api user >/dev/null 2>&1; then
    return 0
  fi

  local helper_pass=""
  helper_pass="$(
    printf 'protocol=https\nhost=github.com\n\n' \
      | git credential fill 2>/dev/null \
      | sed -n 's/^password=//p' \
      | head -n1 || true
  )"
  if [ -n "$helper_pass" ] && GH_TOKEN="$helper_pass" gh api user >/dev/null 2>&1; then
    export GH_TOKEN="$helper_pass"
    echo "gh-auth: gh 默认凭据失效，已回退到 git credential（仅进程内 GH_TOKEN）" >&2
    return 0
  fi

  echo "gh-auth: ERROR 无法认证 GitHub；请运行 'gh auth login -h github.com' 或显式设置 GH_TOKEN" >&2
  return 1
}
