#!/usr/bin/env bash
# ============================================================================
# random_test_runner.sh — 随机单测抽测共享库 (SSOT)
# ============================================================================
# 用途：pre-commit 钩子模板与夜间巡检 (nightly_test_sweep.py) 共用同一套
#       单测资产收集 / 随机选择 / 执行逻辑，避免双份实现漂移。
#
# 两种用法：
#   source（钩子模板）:
#       source "$(cd "$(dirname "$0")" && pwd)/lib/random_test_runner.sh"
#       rt_go_collect_dirs; rt_pick_random 30; rt_go_run_dir ./pkg ...
#
#   CLI（Python 编排器 / 自测）:
#       bash random_test_runner.sh type <repo>          # go|js|py|none
#       bash random_test_runner.sh collect-go <repo>     # 每行一个 ./dir
#       bash random_test_runner.sh collect-js <repo>     # 每行一个文件
#       bash random_test_runner.sh collect-py <repo>
#       bash random_test_runner.sh run-go <repo> <dir>
#       bash random_test_runner.sh run-js <repo> <file>
#       bash random_test_runner.sh run-py <repo> <file>
#       bash random_test_runner.sh pick <ratio>          # stdin 列表 → 随机子集(至少1)
#       bash random_test_runner.sh self-test             # 内置断言自测
#
# 规则：.ai/01_project_constraints/28_commit_random_unit_test_debt_fix.md
#       设计：docs/superpowers/specs/2026-08-05-nightly-test-sweep-design.md (v65)
# ============================================================================
set -u

RT_VERSION="1.0.0"
RT_DEFAULT_RATIO="${PRECOMMIT_TEST_RATIO:-30}"

# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

# cd 到仓库目录（可选 repo 参数；默认留在当前目录）
rt_enter_repo() {
    local repo="${1:-}"
    if [ -n "$repo" ] && [ "$repo" != "." ]; then
        [ -d "$repo" ] || { echo "ERROR: repo dir not found: $repo" >&2; return 1; }
        cd "$repo" || return 1
    fi
}

# 判定仓库测试类型（组合式：go_js_py / go_js / go_py / js_py / go / js / py / none）
rt_repo_type() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    local has_go=0 has_js=0 has_py=0
    if find . -type f -name '*_test.go' \
        -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -1 | grep -q .; then
        has_go=1
    fi
    if find . -type f \( -name '*.unit.test.js' -o -name '*.test.js' -o -name '*.test.mjs' -o -name '*.test.ts' -o -name '*.unit.test.ts' \) \
        -not -path './.git/*' -not -path '*/node_modules/*' \
        -not -name '*.playwright.test.*' -not -name '*.e2e.test.*' -not -name '*.integration.test.*' 2>/dev/null | head -1 | grep -q .; then
        has_js=1
    fi
    if find . -type f \( -name 'test_*.py' -o -name '*_test.py' \) \
        -not -path './.git/*' -not -path '*/node_modules/*' -not -path '*/venv/*' \
        -not -path '*/.venv/*' -not -path '*/site-packages/*' -not -path '*/__pycache__/*' 2>/dev/null | head -1 | grep -q .; then
        has_py=1
    fi
    local out=""
    [ "$has_go" -eq 1 ] && out="${out}go"
    [ "$has_js" -eq 1 ] && out="${out:+${out}_}js"
    [ "$has_py" -eq 1 ] && out="${out:+${out}_}py"
    [ -n "$out" ] && echo "$out" || echo "none"
}

# ---------------------------------------------------------------------------
# Go 收集 / 运行
# ---------------------------------------------------------------------------

# 输出所有含 *_test.go 的包目录（./dir 形式，去重）
rt_go_collect_dirs() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    find . -type f -name '*_test.go' \
        -not -path './.git/*' \
        -not -path './node_modules/*' \
        -not -path './vendor/*' \
        | while IFS= read -r f; do
            local d
            d="$(dirname "$f")"; d="${d#./}"
            if [ "$d" = "." ]; then echo "."; else echo "./${d}"; fi
        done | sort -u
}

# 暂存 .go 文件 → 对应包目录（无对应测例返回 1）
rt_go_dir_for_file() {
    local f="$1"
    case "$f" in
        *.go) ;;
        *) return 1 ;;
    esac
    local d
    d="$(dirname "$f")"; d="${d#./}"
    if [ "$d" = "." ]; then echo "."; else echo "./${d}"; fi
}

rt_go_dir_has_tests() {
    local dir="$1"
    if [ "$dir" = "." ]; then
        find . -maxdepth 1 -type f -name '*_test.go' 2>/dev/null | grep -q .
    else
        find "${dir#./}" -type f -name '*_test.go' 2>/dev/null | grep -q .
    fi
}

# 运行单个包目录的 Go 测试；容忍 "matched no packages"（build tags）；
# 多模块仓（子目录独立 go.mod）自动 fallback：cd 进目录后 go test ./...
rt_go_run_dir() {
    local dir="$1" output
    if [ "$dir" = "." ]; then
        echo "Running: go test -count=1 ."
        output="$(go test -count=1 . 2>&1)" || {
            if echo "$output" | grep -q 'matched no packages'; then
                echo "Skipping ${dir}: no packages to test (build tags)"
                return 0
            fi
            echo "$output"
            return 1
        }
    else
        echo "Running: go test -count=1 ${dir}/..."
        output="$(go test -count=1 "${dir}/..." 2>&1)" || {
            if echo "$output" | grep -qE 'cannot find main module|does not contain main module'; then
                # 多模块仓: 在目录内运行
                echo "Multi-module repo — running inside ${dir}"
                output="$( (cd "${dir#./}" && go test -count=1 ./...) 2>&1)" || {
                    if echo "$output" | grep -q 'matched no packages'; then
                        echo "Skipping ${dir}: no packages to test (build tags)"
                        return 0
                    fi
                    echo "$output"
                    return 1
                }
            elif echo "$output" | grep -q 'matched no packages'; then
                echo "Skipping ${dir}: no packages to test (build tags)"
                return 0
            else
                echo "$output"
                return 1
            fi
        }
    fi
    echo "$output"
    return 0
}

# ---------------------------------------------------------------------------
# JS 收集 / 运行
# ---------------------------------------------------------------------------

rt_js_collect_files() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    find . -type f \
        \( -name '*.test.mjs' -o -name '*.unit.test.js' -o -name '*.test.js' \
           -o -name '*.unit.test.ts' -o -name '*.test.ts' \) \
        -not -path './.git/*' \
        -not -path '*/node_modules/*' \
        -not -name '*.playwright.test.*' \
        -not -name '*.e2e.test.*' \
        -not -name '*.integration.test.*' \
        | sed 's#^\./##' \
        | sort -u
}

rt_js_run_file() {
    local test_file="$1"
    # Vitest projects (frontend/) prefer vitest when present
    if [[ "$test_file" == frontend/* ]] && [ -f frontend/package.json ] && grep -q vitest frontend/package.json 2>/dev/null; then
        echo "Running: (cd frontend && npx vitest run ${test_file#frontend/})"
        (cd frontend && npx vitest run "${test_file#frontend/}")
        return
    fi
    echo "Running: node --test $test_file"
    node --test "$test_file"
}

# ---------------------------------------------------------------------------
# Python 收集 / 运行
# ---------------------------------------------------------------------------

rt_py_collect_files() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    local root
    for root in ${PRECOMMIT_PYTHON_TEST_ROOTS:-tests scripts .}; do
        [ -d "$root" ] || continue
        if [ "$root" = "." ]; then
            find . -maxdepth 3 -type f \( -name 'test_*.py' -o -name '*_test.py' \) \
                -not -path './.git/*' \
                -not -path './node_modules/*' \
                -not -path './venv/*' \
                -not -path './.venv/*' \
                -not -path './site-packages/*' \
                -not -path '*/__pycache__/*' \
                2>/dev/null
        else
            find "$root" -type f \( -name 'test_*.py' -o -name '*_test.py' \) \
                -not -path '*/__pycache__/*' \
                -not -path '*/venv/*' \
                -not -path '*/.venv/*' \
                2>/dev/null
        fi
    done | sed 's#^\./##' | sort -u
}

rt_py_run_file() {
    local test_file="$1"
    if command -v python3 >/dev/null && python3 -c 'import pytest' 2>/dev/null; then
        echo "Running: python3 -m pytest $test_file -q"
        python3 -m pytest "$test_file" -q --tb=line
    else
        echo "Running: python3 $test_file"
        python3 "$test_file"
    fi
}

# ---------------------------------------------------------------------------
# 随机选择（核心）
# ---------------------------------------------------------------------------

# 从 stdin 列表按比例随机选取；输入非空时保证至少选 1 个。
# 用法: rt_collect_go_dirs | rt_pick_random 30
rt_pick_random() {
    local ratio="${1:-$RT_DEFAULT_RATIO}"
    local line n cnt=0 tmp
    tmp="$(mktemp)"
    cat > "$tmp"
    # 1) 按比例抽取
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        if [ "$((RANDOM % 100))" -lt "$ratio" ]; then
            echo "$line"
            cnt=$((cnt + 1))
        fi
    done < "$tmp"
    # 2) 一个都没抽到且输入非空 → 保证 1 个
    if [ "$cnt" -eq 0 ] && [ -s "$tmp" ]; then
        n="$(wc -l < "$tmp" | tr -d ' ')"
        sed -n "$((RANDOM % n + 1))p" "$tmp"
    fi
    rm -f "$tmp"
}

# ---------------------------------------------------------------------------
# 共享 pre-commit 自举跳过：仅变更 hooks/文档时跳过抽测
# 返回 0 → 应跳过（调用方 exit 0）
# ---------------------------------------------------------------------------
rt_bootstrap_skip() {
    local _f _only=1
    local _staged
    _staged="$(git diff --cached --name-only 2>/dev/null || true)"
    [ -z "$_staged" ] && return 1
    while IFS= read -r _f; do
        [ -z "$_f" ] && continue
        case "$_f" in
            scripts/hooks/*|.githooks/*|README.md) ;;
            *) _only=0; break ;;
        esac
    done <<< "$_staged"
    if [ "$_only" -eq 1 ]; then
        echo "Pre-commit bootstrap: only hooks/docs staged; skip random unit tests."
        return 0
    fi
    return 1
}

# ---------------------------------------------------------------------------
# 自测（CI 门禁）
# ---------------------------------------------------------------------------
rt_self_test() {
    local fails=0
    local tmp
    tmp="$(mktemp)"; trap 'rm -f "$tmp"' RETURN

    echo "== rt_self_test: rt_repo_type =="
    local t
    t="$(rt_repo_type "$(dirname "${BASH_SOURCE[0]}")/../../..")"
    case "$t" in
        go|js|py|none|go_js|go_py|js_py|go_js_py) echo "  type ok: $t" ;;
        *) echo "  FAIL type: $t"; fails=$((fails+1)) ;; esac

    echo "== rt_pick_random (ratio=0) =="
    printf 'a\nb\nc\n' > "$tmp"
    local picked
    picked="$(rt_pick_random 0 < "$tmp")"
    if [ -z "$picked" ]; then echo "  FAIL: ratio=0 must still pick 1"; fails=$((fails+1)); else echo "  ok: $picked"; fi

    echo "== rt_pick_random (ratio=100) =="
    picked="$(rt_pick_random 100 < "$tmp")"
    if [ "$(printf '%s\n' "$picked" | grep -c .)" -ne 3 ]; then echo "  FAIL: ratio=100 must pick all"; fails=$((fails+1)); else echo "  ok: all 3"; fi

    echo "== rt_pick_random (ratio=30 subset) =="
    picked="$(rt_pick_random 30 < "$tmp")"
    local cnt
    cnt="$(printf '%s\n' "$picked" | grep -c . || true)"
    if [ "$cnt" -lt 1 ] || [ "$cnt" -gt 3 ]; then echo "  FAIL: picked=$cnt"; fails=$((fails+1)); else echo "  ok: picked $cnt/3"; fi

    echo "== rt_pick_random (empty input) =="
    picked="$(printf '' | rt_pick_random 30)"
    if [ -n "$picked" ]; then echo "  FAIL: empty input must pick nothing"; fails=$((fails+1)); else echo "  ok"; fi

    echo "== rt_go_dir_for_file =="
    local d
    d="$(rt_go_dir_for_file "src/foo_test.go")" || true
    [ "$d" = "./src" ] || { echo "  FAIL: dir_for_file src → $d"; fails=$((fails+1)); }
    d="$(rt_go_dir_for_file "README.md" 2>/dev/null)" && { echo "  FAIL: non-go file must fail"; fails=$((fails+1)); }

    if [ "$fails" -eq 0 ]; then echo "SELF-TEST PASS ✅ (rt ${RT_VERSION})"; else echo "SELF-TEST FAIL: $fails" >&2; return 1; fi
}

# ---------------------------------------------------------------------------
# CLI 分发（直接执行时；被 source 时 $0 为调用方，不进入）
# ---------------------------------------------------------------------------
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    cmd="${1:-}"
    shift 2>/dev/null || true
    case "$cmd" in
        type)        rt_repo_type "${1:-}" ;;
        collect-go)  rt_go_collect_dirs "${1:-}" ;;
        collect-js)  rt_js_collect_files "${1:-}" ;;
        collect-py)  rt_py_collect_files "${1:-}" ;;
        run-go)      rt_enter_repo "${1:-}" && rt_go_run_dir "${2:-}" ;;
        run-js)      rt_enter_repo "${1:-}" && rt_js_run_file "${2:-}" ;;
        run-py)      rt_enter_repo "${1:-}" && rt_py_run_file "${2:-}" ;;
        pick)        rt_pick_random "${1:-}" ;;
        self-test)   rt_self_test ;;
        version)     echo "random_test_runner.sh ${RT_VERSION}" ;;
        *)
            echo "Usage: $0 {type|collect-go|collect-js|collect-py|run-go|run-js|run-py|pick|self-test|version} [repo] [target]" >&2
            exit 2 ;;
    esac
    exit $?
fi
