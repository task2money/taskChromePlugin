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

# ── core.bare 自愈守卫（OPT-20260806-059） ───────────────────────────────────
# 背景: 2026-08-06 runAll 子仓 pre-commit 期间 .git/modules/runAll/config 出现
#       `bare = true`，导致后续 git 命令全部报 "must run in a worktree"（现场
#       unset 恢复）。静态排查 hook 链（pre-commit/commit-msg/session lock/
#       随机抽测）均无 git config 写入点，属外部工具（IDE 会话面板等）以 gitdir
#       为上下文写入 git config 的副作用。
# 处理: 钩子进入/退出时自检 core.bare，若被置位则告警并自动 unset，把「硬故障」
#       降级为「自愈 + 日志暴露」，便于后续复现时定位写入方。
rt_guard_core_bare() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 0
    local bare
    bare="$(git config --get core.bare 2>/dev/null || true)"
    if [ "$bare" = "true" ]; then
        echo "WARN: core.bare=true detected (external git-config writer?) — unsetting to restore worktree (OPT-20260806-059)" >&2
        git config --unset core.bare 2>/dev/null || true
    fi
    return 0
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
# MySQL 测试跨进程互斥（OPT-20260823-020）
# ---------------------------------------------------------------------------
# 背景: crontab 夜间 sweep 与多个 /goal 会话的 pre-commit 会并发对同一
#       docker-mysql 跑 go test，DDL/fsync 打满 CPU（LRN-20260823-001）。
#       用共享 flock 串行化所有打 MySQL 的 Go 测试进程（CLI sweep / pre-commit /
#       手动 /goal 共用同一把锁 logs/.mysql-gotest.lock）。
# 行为: 获取锁成功 → 运行命令并保留退出码；等待超时仍未获取 → WARN + 跳过
#       （返回 0，不阻断提交 / 不并行 CREATE TABLE）。
# 开关: RT_MYSQL_TEST_LOCK=0 显式关闭；等待上限 RT_MYSQL_TEST_LOCK_TIMEOUT
#       （默认 300s）；RT_MYSQL_TEST_LOCK_PATH 显式覆盖锁文件（自测用）。
RT_MYSQL_TEST_LOCK="${RT_MYSQL_TEST_LOCK:-1}"
RT_MYSQL_TEST_LOCK_TIMEOUT="${RT_MYSQL_TEST_LOCK_TIMEOUT:-300}"

rt_mysql_test_lock_path() {
    local p="${RT_MYSQL_TEST_LOCK_PATH:-}"
    if [ -n "$p" ]; then echo "$p"; return 0; fi
    local root
    root="$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)"
    if [ -n "$root" ] && [ -d "$root/logs" ]; then
        echo "$root/logs/.mysql-gotest.lock"; return 0
    fi
    local d
    d="$(pwd)"
    while [ "$d" != "/" ]; do
        if [ -d "$d/logs" ] && { [ -d "$d/.git" ] || [ -f "$d/.git" ]; }; then
            echo "$d/logs/.mysql-gotest.lock"; return 0
        fi
        d="$(dirname "$d")"
    done
    return 1
}

# OPT-20260918-003：记录获得锁前的等待秒数，避免夜检把「等锁」误标为「挂死」。
# - stderr 行：RT_LOCK_WAIT_SEC=<n>（获得锁后或等锁失败时）
# - 可选 RT_LOCK_WAIT_FILE：先写 start=<epoch>，成功后再写 sec=<n>（TimeoutExpired 时可估等待）
rt_mysql_test_lock_write_start() {
    local f="${RT_LOCK_WAIT_FILE:-}"
    [ -n "$f" ] || return 0
    printf 'start=%s\n' "$(date +%s)" > "$f" || true
}

rt_mysql_test_lock_write_sec() {
    local sec="$1"
    local f="${RT_LOCK_WAIT_FILE:-}"
    echo "RT_LOCK_WAIT_SEC=${sec}" >&2
    [ -n "$f" ] || return 0
    {
        printf 'start=%s\n' "${_RT_LOCK_WAIT_START:-$(date +%s)}"
        printf 'sec=%s\n' "$sec"
    } > "$f" || true
}

rt_mysql_test_lock_run() {
    local cmd="$1"
    if [ "${RT_MYSQL_TEST_LOCK:-1}" = "0" ]; then
        eval "$cmd"; return $?
    fi
    local lock
    lock="$(rt_mysql_test_lock_path 2>/dev/null || true)"
    if [ -z "$lock" ] || ! command -v flock >/dev/null 2>&1; then
        eval "$cmd"; return $?
    fi
    local ldir
    ldir="$(dirname "$lock")"
    if [ -n "$ldir" ]; then mkdir -p "$ldir" 2>/dev/null || true; fi
    (
        _RT_LOCK_WAIT_START="$(date +%s)"
        export _RT_LOCK_WAIT_START
        rt_mysql_test_lock_write_start
        flock -w "$RT_MYSQL_TEST_LOCK_TIMEOUT" 9
        if [ $? -ne 0 ]; then
            local waited=$(( $(date +%s) - _RT_LOCK_WAIT_START ))
            rt_mysql_test_lock_write_sec "$waited"
            echo "WARN: MySQL test lock busy (${lock}) after ${RT_MYSQL_TEST_LOCK_TIMEOUT}s — skip go test to avoid DDL/fsync storm (OPT-20260823-020)" >&2
            exit 0
        fi
        local waited=$(( $(date +%s) - _RT_LOCK_WAIT_START ))
        rt_mysql_test_lock_write_sec "$waited"
        eval "$cmd"
    ) 9> "$lock"
    return $?
}

# ---------------------------------------------------------------------------
# Go 收集 / 运行
# ---------------------------------------------------------------------------

# 输出所有含 *_test.go 的包目录（./dir 形式，去重）
# 排除 third_party/（vendored 第三方库的测试属上游集成测试，需真实外部依赖，
# 如 kafka-go 的 conn_test.go 会连 localhost:9092 自动创建 kafka-go-* topics，
# 污染 Kafka metadata —— 见 docs/superpowers/specs/2026-08-10-kafka-go-topic-pollution-fix-design.md）
rt_go_collect_dirs() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    find . -type f -name '*_test.go' \
        -not -path './.git/*' \
        -not -path './node_modules/*' \
        -not -path './vendor/*' \
        -not -path './third_party/*' \
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
# KAFKA_SKIP_NETTEST=1: 双保险——即使 third_party 排除规则失效或他处直接
# 运行 kafka-go 库测试，也跳过需要真实 broker 的 nettest 集成用例，
# 阻止自动创建 kafka-go-* 无意义命名 topics（kafka-go 库测试自带门控）。
rt_go_run_dir() {
    local dir="$1" output
    export KAFKA_SKIP_NETTEST=1
    # 与各仓 .githooks/lib/random_test_runner.sh 对齐（OPT-20260919-002）：
    # go test 默认注入的 10m 内部闹钟会早于外部预算触发 —— 夜检给
    # taskCloudService 的预算已放宽到 900s（OPT-20260917-008），却仍以
    # `panic: test timed out after 10m0s` 被杀，即「预算是够的、闹钟定早了」。
    # 内部超时只需大于外部预算，真正的上限始终由外层 timeout 兜底；
    # 可用 PRECOMMIT_GO_TIMEOUT 覆盖。
    local go_timeout="${PRECOMMIT_GO_TIMEOUT:-45m}"
    if [ "$dir" = "." ]; then
        echo "Running: go test -count=1 -timeout ${go_timeout} ."
        output="$(rt_mysql_test_lock_run "go test -count=1 -timeout ${go_timeout} ." 2>&1)" || {
            if echo "$output" | grep -q 'matched no packages'; then
                echo "Skipping ${dir}: no packages to test (build tags)"
                return 0
            fi
            echo "$output"
            return 1
        }
    else
        echo "Running: go test -count=1 -timeout ${go_timeout} ${dir}/..."
        output="$(rt_mysql_test_lock_run "go test -count=1 -timeout ${go_timeout} ${dir}/..." 2>&1)" || {
            if echo "$output" | grep -qE 'cannot find main module|does not contain main module'; then
                # 多模块仓: 在目录内运行
                echo "Multi-module repo — running inside ${dir}"
                output="$(rt_mysql_test_lock_run "(cd \"${dir#./}\" && go test -count=1 -timeout ${go_timeout} ./...)" 2>&1)" || {
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

    echo "== rt_mysql_test_lock_run (free lock → cmd runs) =="
    local tmplock out2
    tmplock="$(mktemp)"
    out2="$(RT_MYSQL_TEST_LOCK_PATH="$tmplock" rt_mysql_test_lock_run "echo RUN_OK" 2>&1)"
    echo "$out2" | grep -q "RUN_OK" || { echo "  FAIL: free lock did not run cmd: $out2"; fails=$((fails+1)); }
    if RT_MYSQL_TEST_LOCK_PATH="$tmplock" rt_mysql_test_lock_run "return 7"; then
        echo "  FAIL: expected non-zero exit from cmd"; fails=$((fails+1))
    else
        echo "  ok: non-zero exit propagates"
    fi
    rm -f "$tmplock"

    echo "== rt_mysql_test_lock_run (lock held → skip, no parallel run) =="
    tmplock="$(mktemp)"
    local marker holder out3
    marker="$(mktemp)"
    (
        flock 8
        echo acquired > "$marker"
        sleep 3
    ) 8> "$tmplock" &
    holder=$!
    # 等待 holder 真正持锁，避免竞态误判
    for _ in $(seq 1 50); do
        [ -s "$marker" ] && break
        sleep 0.1
    done
    out3="$(RT_MYSQL_TEST_LOCK_PATH="$tmplock" RT_MYSQL_TEST_LOCK_TIMEOUT=1 rt_mysql_test_lock_run "echo MUST_NOT_RUN" 2>&1)"
    if echo "$out3" | grep -q "WARN: MySQL test lock busy"; then
        echo "  ok: skipped on busy lock"
    else
        echo "  FAIL: expected skip-on-busy, got: $out3"; fails=$((fails+1))
    fi
    if echo "$out3" | grep -q "MUST_NOT_RUN"; then
        echo "  FAIL: cmd ran while lock held"; fails=$((fails+1))
    fi
    wait "$holder"
    rm -f "$tmplock" "$marker"

    echo "== rt_mysql_test_lock_path =="
    local lp
    lp="$(RT_MYSQL_TEST_LOCK_PATH="" rt_mysql_test_lock_path 2>/dev/null || true)"
    case "$lp" in
        */logs/.mysql-gotest.lock) echo "  ok: lock path resolved: $lp" ;;
        *) echo "  FAIL: lock path unexpected: '$lp'"; fails=$((fails+1)) ;;
    esac

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
