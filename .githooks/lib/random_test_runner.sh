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
#       bash random_test_runner.sh run-js-batch <repo> <file>...   # 同 vitest 工程合并跑
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
# 另按仓自身 .gitignore 剔除被忽略路径（OPT-20260926-003）：本地嵌套克隆的第三方
# SDK（如 sdk/tencent/cos-go-sdk-v5）不入库，抽其用例既修不了也推不出去，只产假债。
rt_go_collect_dirs() {
    local repo="${1:-}"
    rt_enter_repo "$repo" || return 1
    local files
    files="$(find . -type f -name '*_test.go' \
        -not -path './.git/*' \
        -not -path './node_modules/*' \
        -not -path './vendor/*' \
        -not -path './third_party/*' 2>/dev/null)"
    [ -n "$files" ] || return 0
    # check-ignore 无命中时退出码为 1（本文件仅 set -u，故容错）；非 git 仓亦安全退化。
    local ignored
    ignored="$(printf '%s\n' "$files" | git check-ignore --stdin 2>/dev/null || true)"
    if [ -n "$ignored" ]; then
        files="$(printf '%s\n' "$files" | grep -vxF -f <(printf '%s\n' "$ignored") || true)"
    fi
    [ -n "$files" ] || return 0
    printf '%s\n' "$files" | while IFS= read -r f; do
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

# ── JS 运行器探测（OPT-20261014-001） ───────────────────────────────────────
# 缺陷形态：`rt_js_run_file` 此前只对**硬编码的** `frontend/` 前缀走 vitest，其余
# 一律 `node --test`。vitest 工程（taskFE 的工程在 `app/` 而非 `frontend/`）里的
# `*.test.js` 被 node:test 当普通脚本执行：文件体照跑、0 个用例注册，node 记
# `# tests 1 / # pass 1` 并 **exit 0** —— 抽测与 pre-commit 于是对前端 JS 恒绿
# （2026-10-14 夜检 397 个 taskFE JS 文件全记 PASS，其中含 8 个确定性失败文件），
# 而每次 taskFE 提交还白花 5-10 分钟跑空用例。恒绿判据比没有判据更糟：真回归既
# 不被巡检发现也不阻断提交。
# 现改为按工程探测：从测试文件向上取**最近的** package.json，其依赖里声明了
# vitest 即走 vitest（`frontend/` 特例被此规则自然覆盖），否则回落 node --test。

# rt_js_project_for_file <test_file> — 输出该测试文件所属的 vitest 工程目录
# （仓根为 "."，子工程为 "app" 形态）；非 vitest 工程 → 非 0。
rt_js_project_for_file() {
    local file="${1#./}" dir pkg parent
    dir="$(dirname "$file")"
    [ "$dir" = "." ] && dir=""
    while :; do
        pkg="${dir:+$dir/}package.json"
        if [ -f "$pkg" ]; then
            # 判据取**依赖键**形态（"vitest" / "@vitest/ui" …）：`"test": "vitest run"`
            # 只是调用方式，无权把工程判成 vitest 工程（会连 node --test 工程一起改道）。
            if grep -qE '"(vitest|@vitest/[^"]+)"[[:space:]]*:' "$pkg" 2>/dev/null; then
                if [ -n "$dir" ]; then printf '%s\n' "$dir"; else printf '.\n'; fi
                return 0
            fi
            # 最近的 package.json 未声明 vitest → 该文件归 node --test（工程边界即判据）
            return 1
        fi
        [ -z "$dir" ] && break
        parent="$(dirname "$dir")"
        if [ "$parent" = "." ]; then dir=""; else dir="$parent"; fi
    done
    return 1
}

# rt_js_run_vitest_group <proj> <test_file>... — 同一工程合并为**一次** vitest 调用。
# 为何必须批量：per-file vitest 实测 ~4-6s，taskFE 抽测 397 文件 ≈ 30 分钟，
# 超 pre-commit 900s 与夜检单测例预算；整工程一次调用是分钟量级。
# 输出：每文件一行 `RT_JS_RESULT PASS|FAIL <仓根相对路径>`（供夜检逐文件归属）；
# 任一文件未通过或批次异常 → 非 0。
rt_js_run_vitest_group() {
    local proj="$1"; shift
    local vbin json err attr list line f rel rc=0
    if [ "$proj" = "." ]; then vbin="./node_modules/.bin/vitest"; else vbin="$proj/node_modules/.bin/vitest"; fi
    if [ ! -x "$vbin" ]; then
        # 声明了 vitest 却没装 → 拒绝回落 node --test：那正是本条要消灭的「0 用例恒绿」。
        echo "ERROR: ${proj} 声明了 vitest 依赖，但未安装（缺 ${vbin}）" >&2
        echo "       vitest 用例在 node --test 下会「0 用例恒绿」，故不回落；修复: (cd $proj && npm install)" >&2
        for f in "$@"; do echo "RT_JS_RESULT FAIL $f"; done
        return 1
    fi
    json="$(mktemp)"; err="$(mktemp)"; attr="$(mktemp)"; list="$(mktemp)"
    local -a rels=()
    for f in "$@"; do
        f="${f#./}"
        if [ "$proj" = "." ]; then rel="$f"; else rel="${f#"$proj"/}"; fi
        # 前缀 `./` 而非 `--` 保证「路径绝不被当成选项」：vitest 的 `--` 是
        # passThroughArgs（透传给被测进程），写 `-- a.test.js` 会让 vitest **丢掉
        # 这个过滤条件而跑全量**（实测单文件批次从 7s 变 200s+ 且报告里全是别的文件），
        # `./a.test.js` 才是安全的过滤参数。
        rels+=("./$rel")
    done
    printf '%s\n' "$@" > "$list"
    echo "Running: (cd $proj && ./node_modules/.bin/vitest run --reporter=json) [${#rels[@]} file(s)]"
    # json reporter 无 --outputFile 时把报告写 stdout，诊断走 stderr；分开重定向，
    # 报告与人类可读输出互不污染。
    (cd "$proj" && ./node_modules/.bin/vitest run --reporter=json "${rels[@]}" >"$json" 2>"$err") || rc=1
    rt_js_attribute_json "$json" "$proj" "$list" > "$attr" 2>/dev/null || true
    local nfail
    nfail="$(grep -c '^RT_JS_RESULT FAIL ' "$attr" || true)"
    if [ "$rc" -ne 0 ] && [ "${nfail:-0}" -eq 0 ]; then
        # 批次退出非 0 却无文件级失败（未处理异常 / 快照过期 / 收集失败未落报告）
        # → fail-closed 记全部失败：宁可多报也不能把非 0 说成通过。
        echo "WARN: vitest 批次退出非 0 但报告内无失败文件 —— 按 fail-closed 记全部失败" >&2
        : > "$attr"
        for f in "$@"; do echo "RT_JS_RESULT FAIL $f" >> "$attr"; done
        rc=1
    fi
    if [ "$rc" -ne 0 ] && [ -s "$err" ]; then
        echo "---- vitest stderr (tail) ----"
        tail -15 "$err"
    fi
    while IFS= read -r line; do
        printf '%s\n' "$line"
        case "$line" in
            "RT_JS_RESULT FAIL "*) rc=1 ;;
        esac
    done < "$attr"
    rm -f "$json" "$err" "$attr" "$list"
    return "$rc"
}

# rt_js_attribute_json <report.json> <proj> <requested_list_file> — 把 vitest JSON
# 报告里的逐文件状态翻成 `RT_JS_RESULT` 行（仓根相对路径）；报告里查不到的文件
# 记 FAIL（fail-closed），并带上失败断言信息供修复用。
rt_js_attribute_json() {
    python3 - "$1" "$2" "$3" <<'PY'
import json, os, sys

report, proj, list_path = sys.argv[1], sys.argv[2], sys.argv[3]
requested = [ln.strip() for ln in open(list_path, encoding="utf-8") if ln.strip()]
try:
    with open(report, encoding="utf-8") as fh:
        data = json.load(fh)
except Exception as exc:  # noqa: BLE001 — 报告缺失/截断一律 fail-closed
    print(f"RT_JS_NOTE vitest JSON 报告不可读（{exc}）")
    data = None

by_abs: dict[str, tuple[str | None, list[str]]] = {}
if isinstance(data, dict):
    for tr in data.get("testResults") or []:
        msgs = [str(m) for ar in (tr.get("assertionResults") or [])
                for m in (ar.get("failureMessages") or [])]
        by_abs[os.path.realpath(tr.get("name") or "")] = (tr.get("status"), msgs)

proj_abs = os.path.realpath(proj)
for rel_repo in requested:
    rel_proj = rel_repo if proj == "." else rel_repo[len(proj) + 1:]
    hit = by_abs.get(os.path.realpath(os.path.join(proj_abs, rel_proj)))
    if hit is None:
        # realpath 不一致（软链工程）时退化为唯一后缀匹配
        cands = [v for k, v in by_abs.items() if k.endswith("/" + rel_proj)]
        hit = cands[0] if len(cands) == 1 else None
    if hit is None:
        print(f"RT_JS_RESULT FAIL {rel_repo}")
        print(f"RT_JS_NOTE {rel_repo}: vitest 报告未含该文件（收集失败/进程异常退出？）")
        continue
    status, msgs = hit
    print(f"RT_JS_RESULT {'PASS' if status == 'passed' else 'FAIL'} {rel_repo}")
    if status != "passed":
        for m in msgs[:3]:
            for ln in m.splitlines()[:12]:
                print(f"    | {ln}")
PY
}

# rt_js_runner_for_file <test_file> — 逐文件判定运行器，输出 `vitest <proj>` 或 `node`。
# 为何不能只看工程：vitest 工程内**并存** node:test 文件（taskFE 的 app/ 有 22 个），
# 项目自己在 vite.config.js 里按「文件头是否 `from 'node:test'`」把它们从 vitest
# 排除（collectNodeTestFiles），交给 pre-commit 的 node --test 跑。若只按工程判定，
# 这 22 个真用例会被丢给 vitest → `No test suite found` → 变成新的假红。
# 判据与之一致：文件头 4096 字节内出现 `from 'node:test'` 即归 node --test。
rt_js_runner_for_file() {
    local file="${1#./}" proj
    if head -c 4096 "$file" 2>/dev/null | grep -aqE "from[[:space:]]+['\"]node:test['\"]"; then
        printf 'node\n'
        return 0
    fi
    if proj="$(rt_js_project_for_file "$file")"; then
        printf 'vitest %s\n' "$proj"
        return 0
    fi
    printf 'node\n'
}

# rt_js_run_batch <test_file>... — 抽测 / pre-commit 的批量入口（跨仓 SSOT 契约）。
# 同一 vitest 工程的文件合并为一次 vitest 调用；node --test 文件逐个跑。
# 输出每文件一行 `RT_JS_RESULT PASS|FAIL <file>`；任一失败 → 非 0。
rt_js_run_batch() {
    local -a nfiles=() projs=()
    local -A group=()
    local f proj runner p rc=0
    for f in "$@"; do
        f="${f#./}"
        [ -n "$f" ] || continue
        runner="$(rt_js_runner_for_file "$f")"
        if [ "${runner%% *}" = "vitest" ]; then
            proj="${runner#vitest }"
            if [ -z "${group[$proj]:-}" ]; then
                projs+=("$proj")
                group[$proj]="$f"
            else
                group[$proj]="${group[$proj]}"$'\n'"$f"
            fi
        else
            nfiles+=("$f")
        fi
    done
    local -a files=()
    for p in ${projs[@]+"${projs[@]}"}; do
        files=()
        while IFS= read -r f; do [ -n "$f" ] && files+=("$f"); done <<< "${group[$p]}"
        rt_js_run_vitest_group "$p" ${files[@]+"${files[@]}"} || rc=1
    done
    for f in ${nfiles[@]+"${nfiles[@]}"}; do
        echo "Running: node --test $f"
        if node --test "$f"; then
            echo "RT_JS_RESULT PASS $f"
        else
            echo "RT_JS_RESULT FAIL $f"
            rc=1
        fi
    done
    return "$rc"
}

# 单文件入口（CLI `run-js` 兼容；逐文件输出的场景）。语义与批量入口一致。
rt_js_run_file() {
    rt_js_run_batch "${1:-}"
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

    echo "== rt_go_collect_dirs 跳过 .gitignore 忽略的嵌套克隆 (OPT-20260926-003) =="
    # sdk 仓的 tencent/ 是「本地调试用第三方 SDK 嵌套克隆」：自带 .git、被 .gitignore
    # 忽略、不入库（COS 预签名已走 Go module）。抽到它既修不了（改动推不出去）、也发不
    # 出去，只会反复生成无法消解的假债。以仓自身 .gitignore 为 SSOT 剔除。
    local sandbox got
    sandbox="$(mktemp -d)"
    trap 'rm -f "$tmp"; rm -rf "$sandbox"' RETURN
    got="$(
        unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY
        cd "$sandbox" || exit 1
        git init -q . >/dev/null 2>&1 || exit 1
        printf 'nested/\n' > .gitignore || exit 1
        mkdir -p pkg nested/deep || exit 1
        : > pkg/pkg_test.go
        : > nested/deep/clone_test.go
        git add pkg/pkg_test.go .gitignore >/dev/null 2>&1
        rt_go_collect_dirs . 2>/dev/null
    )"
    if [ "$got" = "./pkg" ]; then
        echo "  ok: 保留 tracked 包、剔除 gitignored 嵌套克隆"
    else
        echo "  FAIL: collect-go 结果 '$(printf '%s' "$got" | tr '\n' ' ')'（want './pkg'）"; fails=$((fails+1))
    fi

    echo "== rt_js_runner_for_file / rt_js_run_batch (OPT-20261014-001) =="
    # 回归的缺陷形态：vitest 工程（taskFE 的工程在 app/ 而非 frontend/）里的
    # *.test.js 被 node:test 当普通脚本执行 → 0 用例注册、node 记 1 pass 并 exit 0，
    # 抽测与 pre-commit 于是对前端 JS 恒绿。判据必须真的把 vitest 工程的文件送进
    # vitest —— 真 vitest 依赖 node_modules/网络，故用**桩 vitest** 固定「送进去了」
    # 与「逐文件结果被正确归属」两件事。
    local jsfix jsr jsr2 jsr3 jsout jsrc jsout2 jsrc2 jsout3 jsrc3
    jsfix="$(mktemp -d)"
    trap 'rm -f "$tmp"; rm -rf "$sandbox" "$jsfix"' RETURN
    mkdir -p "$jsfix/app/src/views" "$jsfix/app/node_modules/.bin" "$jsfix/web/tests" "$jsfix/bare/src"
    printf '{"name":"app","devDependencies":{"vitest":"^4.0.18"}}\n' > "$jsfix/app/package.json"
    printf '{"name":"root","devDependencies":{"jsdom":"^29.1.0"}}\n' > "$jsfix/package.json"
    printf '{"name":"bare","dependencies":{"vitest":"^4.0.18"}}\n' > "$jsfix/bare/package.json"
    printf "import { describe, it } from 'vitest'\n" > "$jsfix/app/src/views/spa.test.js"
    printf "import { describe, it } from 'vitest'\n" > "$jsfix/app/src/views/other.test.js"
    # 真 node:test 用例（工程内并存，必须仍走 node --test 而不是被丢给 vitest）
    cat > "$jsfix/app/src/views/legacy.test.js" <<'JS'
import test from 'node:test'
import assert from 'node:assert/strict'
test('工程内 node:test 用例', () => { assert.equal(1, 1) })
JS
    printf "// 无框架 import：工程未声明 vitest → 归 node --test（不看文件内容）\n" > "$jsfix/web/tests/plain.test.mjs"
    # 桩 vitest：解析过滤参数，按 RT_STUB_FAIL/RT_STUB_OMIT 产出 JSON 报告
    cat > "$jsfix/app/node_modules/.bin/vitest" <<'STUB'
#!/usr/bin/env bash
printf 'CALL %s\n' "$*" >> "${RT_STUB_CALLS:-/dev/null}"
files=()
for a in "$@"; do
    case "$a" in run|--reporter=*) continue ;; esac
    files+=("$a")
done
overall=passed
printf '{"success":true,"testResults":['
first=1
for f in ${files[@]+"${files[@]}"}; do
    base="$(basename "$f")"
    case " ${RT_STUB_OMIT:-} " in *" $base "*) continue ;; esac
    st=passed; extra=""
    case " ${RT_STUB_FAIL:-} " in
        *" $base "*) st=failed; overall=failed
            extra=',"assertionResults":[{"failureMessages":["AssertionError: stub 故意失败"]}]' ;;
    esac
    [ "$first" -eq 1 ] || printf ','
    first=0
    printf '{"name":"%s/%s","status":"%s"%s}' "$PWD" "${f#./}" "$st" "$extra"
done
printf ']}\n'
[ "$overall" = passed ]
STUB
    chmod +x "$jsfix/app/node_modules/.bin/vitest"

    # (1) 工程判定：最近的 package.json 声明 vitest → vitest <proj>
    jsr="$(cd "$jsfix" && rt_js_runner_for_file app/src/views/spa.test.js 2>/dev/null || true)"
    if [ "$jsr" = "vitest app" ]; then
        echo "  ok: app/ 下 vitest 文件判给 vitest app（frontend/ 特例已被工程探测取代）"
    else
        echo "  FAIL: app/ 下 vitest 文件判定为 '$jsr'（want 'vitest app'）"; fails=$((fails+1))
    fi
    # (2) 文件头 node:test → node（工程内并存，判据必须逐文件）
    jsr="$(cd "$jsfix" && rt_js_runner_for_file app/src/views/legacy.test.js 2>/dev/null || true)"
    if [ "$jsr" = "node" ]; then
        echo "  ok: 工程内 node:test 文件仍归 node --test（不被丢给 vitest 造成假红）"
    else
        echo "  FAIL: 工程内 node:test 文件判定为 '$jsr'（want 'node'）"; fails=$((fails+1))
    fi
    # (3) 无 vitest 声明的工程 → node
    jsr3="$(cd "$jsfix" && rt_js_runner_for_file web/tests/plain.test.mjs 2>/dev/null || true)"
    if [ "$jsr3" = "node" ]; then
        echo "  ok: 未声明 vitest 的工程归 node --test"
    else
        echo "  FAIL: 未声明 vitest 的工程判定为 '$jsr3'（want 'node'）"; fails=$((fails+1))
    fi
    # (4) 批量 + 逐文件归属：2 个 vitest 文件一次调用、1 个 node 文件真跑；桩只让
    #     other.test.js 失败 → 必须有 FAIL 归属且整体非 0
    jsrc=0
    jsout="$(cd "$jsfix" && RT_STUB_CALLS="$jsfix/calls" RT_STUB_FAIL="other.test.js" \
        rt_js_run_batch app/src/views/spa.test.js app/src/views/other.test.js app/src/views/legacy.test.js 2>&1)" || jsrc=$?
    if [ "$(grep -c '^CALL ' "$jsfix/calls" 2>/dev/null || echo 0)" = "1" ] \
       && grep -q 'spa.test.js' "$jsfix/calls" && grep -q 'other.test.js' "$jsfix/calls"; then
        echo "  ok: 同工程 2 文件合并为 1 次 vitest 调用（批量入口生效）"
    else
        echo "  FAIL: 未合并（calls=$(cat "$jsfix/calls" 2>/dev/null | tr '\n' '|')）"; fails=$((fails+1))
    fi
    if printf '%s\n' "$jsout" | grep -qx 'RT_JS_RESULT PASS app/src/views/spa.test.js' \
       && printf '%s\n' "$jsout" | grep -qx 'RT_JS_RESULT PASS app/src/views/legacy.test.js'; then
        echo "  ok: 通过文件逐个记 PASS（含真 node:test 文件）"
    else
        echo "  FAIL: 通过文件未记 PASS: $(printf '%s\n' "$jsout" | grep -c 'RT_JS_RESULT')"; fails=$((fails+1))
    fi
    if printf '%s\n' "$jsout" | grep -qx 'RT_JS_RESULT FAIL app/src/views/other.test.js' && [ "$jsrc" -ne 0 ]; then
        echo "  ok: 失败文件归属到文件且整体退出非 0"
    else
        echo "  FAIL: 失败未被归属（rc=${jsrc}）"; fails=$((fails+1))
    fi
    if printf '%s\n' "$jsout" | grep -q 'stub 故意失败'; then
        echo "  ok: 失败断言信息透出（修复闭环可诊断）"
    else
        echo "  FAIL: 失败断言信息缺失"; fails=$((fails+1))
    fi
    # (5) 报告里缺文件（收集失败等）→ fail-closed 记 FAIL
    jsrc2=0
    jsout2="$(cd "$jsfix" && RT_STUB_CALLS="$jsfix/calls2" RT_STUB_OMIT="other.test.js" \
        rt_js_run_batch app/src/views/spa.test.js app/src/views/other.test.js 2>&1)" || jsrc2=$?
    if printf '%s\n' "$jsout2" | grep -qx 'RT_JS_RESULT FAIL app/src/views/other.test.js' && [ "$jsrc2" -ne 0 ]; then
        echo "  ok: 报告缺文件时 fail-closed 记 FAIL（不静默当通过）"
    else
        echo "  FAIL: 报告缺文件未 fail-closed（rc=${jsrc2}）"; fails=$((fails+1))
    fi
    # (6) 声明 vitest 却没装 → 拒跑且**不得**回落 node --test（回落即恒绿复发）
    jsrc3=0
    jsout3="$(cd "$jsfix" && rt_js_run_batch bare/src/x.test.js 2>&1)" || jsrc3=$?
    if printf '%s\n' "$jsout3" | grep -qx 'RT_JS_RESULT FAIL bare/src/x.test.js' && [ "$jsrc3" -ne 0 ] \
       && ! printf '%s\n' "$jsout3" | grep -q '^Running: node --test'; then
        echo "  ok: vitest 未安装时拒跑且不回落 node --test（不制造新的恒绿）"
    else
        echo "  FAIL: vitest 未安装时回落了 node --test（rc=${jsrc3}）: $(printf '%s\n' "$jsout3" | head -3 | tr '\n' '|')"
        fails=$((fails+1))
    fi
    rm -rf "$jsfix"

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
        run-js-batch) rt_enter_repo "${1:-}" && shift && rt_js_run_batch "$@" ;;
        run-py)      rt_enter_repo "${1:-}" && rt_py_run_file "${2:-}" ;;
        pick)        rt_pick_random "${1:-}" ;;
        self-test)   rt_self_test ;;
        version)     echo "random_test_runner.sh ${RT_VERSION}" ;;
        *)
            echo "Usage: $0 {type|collect-go|collect-js|collect-py|run-go|run-js|run-js-batch|run-py|pick|self-test|version} [repo] [target...]" >&2
            exit 2 ;;
    esac
    exit $?
fi
