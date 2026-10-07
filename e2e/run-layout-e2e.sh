#!/usr/bin/env bash
# 布局/几何 E2E 门禁（OPT-20261008-002）
#
# 为什么存在：
#   `popup-layout.playwright.test.js` 里「系统智能体分组」断言自 commit 02bc779
#   起即失效（分组名以 <optgroup label> 呈现，原生 <select> 的 textContent 不含
#   该字面量），却因该文件不在任何门禁、默认 `npm test` 只跑 test/*.test.js 而
#   长期红而无人知。不跑的布局断言等于不存在，同类漂移会掩盖真实回归。
#
# 本脚本只跑**自包含**的布局/几何用例（file:// 或本地静态源 + chrome stub，
# 无登录 / 无真实扩展 / 无外网），退出码即判据：非 0 即失败。
# 勿并入默认 `npm test`（会拉长每次提交），改由 pre-commit 在插件布局承载面
# （popup/ panel/ content/ lib/）变更时调用，或手动执行。
#
# 用法：bash e2e/run-layout-e2e.sh
# 覆盖用例集：LAYOUT_E2E_FILES="e2e/x.playwright.test.js e2e/y.playwright.test.js" bash e2e/run-layout-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PW_BIN="${PW_BIN:-npx playwright}"

# 自包含布局/几何用例（均为绿色基准，新增用例请先确认可稳定跑绿再纳入）。
FILES=(
  e2e/popup-layout.playwright.test.js
  e2e/float-close-collapse.playwright.test.js
  e2e/page-advisor-region-float.playwright.test.js
)
if [ -n "${LAYOUT_E2E_FILES:-}" ]; then
  # shellcheck disable=SC2206
  read -r -a FILES <<< "${LAYOUT_E2E_FILES}"
fi

# CI=1 走无头（见 e2e/playwright.config.js）；无头下断言所需 locale 由各用例
# 自行钉死，勿依赖宿主 navigator.language。
export CI=1
$PW_BIN test -c e2e/playwright.config.js "${FILES[@]}" --timeout=60000
echo "run-layout-e2e.sh: OK (${#FILES[@]} files)"
