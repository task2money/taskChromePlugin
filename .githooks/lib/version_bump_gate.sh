#!/bin/bash
# 插件版本号门禁（OPT-20260923-009；对照约束 68/69 与 scripts/pack-crx.sh 的 PACK_PATHS）。
#
# 暂存了插件运行时路径、但 manifest.json 的 version 相对 HEAD 没变时失败：
# 不升版本时 Chrome 与 GitHub Release 都看不到新包，用户会以为提交没有生效
# （v1.8.87 那类「改了 popup 却没升版本」的提交会把 zip 覆盖到旧 tag）。
#
# 不触发：纯文档、纯测试、.githooks、_locales 生成物、icons。
# 说明：manifest.json 的 version 取索引内容（未暂存则回落 HEAD），
# 因此「只升了工作区、没 add」同样会被拦下。

PLUGIN_RUNTIME_PATH_RE='^(popup|lib|content|background|devtools|panel)/'

# 从 manifest.json 的指定 revision（如 HEAD:manifest.json 或 :manifest.json）读 version
plugin_manifest_version() {
    git show "$1" 2>/dev/null \
        | tr -d '\n' \
        | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

# 运行时路径有暂存变更但版本未变时返回 1（并打印提示）
version_bump_gate() {
    local staged runtime_staged=0 line prev next
    staged="$(git diff --cached --name-only 2>/dev/null || true)"
    if [ -z "$staged" ]; then
        return 0
    fi
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        [ "$line" = "manifest.json" ] && continue
        if printf '%s' "$line" | grep -Eq "$PLUGIN_RUNTIME_PATH_RE"; then
            runtime_staged=1
            break
        fi
    done <<< "$staged"
    if [ "$runtime_staged" -ne 1 ]; then
        return 0
    fi

    prev="$(plugin_manifest_version HEAD:manifest.json)"
    next="$(plugin_manifest_version :manifest.json)"
    [ -n "$next" ] || next="$prev"
    if [ -z "$prev" ] || [ "$prev" != "$next" ]; then
        return 0
    fi

    echo "pre-commit: 暂存了插件运行时路径，但 manifest.json 的 version 未变（$prev）。" >&2
    echo "请先升 patch 版本，再提交运行时改动；升版本后须运行" >&2
    echo "  python3 db/scripts/ci/ensure_plugin_client_version_sql.py --notes '<本版迭代说明>'" >&2
    echo "登记插件版本目录（约束 69）。" >&2
    return 1
}
