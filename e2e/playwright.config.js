'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolvePlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    const fallback = path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test');
    return require(fallback);
  }
}

const { defineConfig } = resolvePlaywrightTest();

/**
 * 环境自适应的 chromium 回退：
 * 部分开发机只缓存了旧版 playwright 的完整 chromium（无本版本所需的
 * chromium_headless_shell），直接运行会报 Executable doesn't exist。
 * 检测到期望的 headless shell 缺失时，回退到缓存中最新完整 chromium（兼容 headless 模式）。
 */
function resolveChromiumFallback() {
  try {
    const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(cache)) return null;

    // 期望的 headless shell revision（来自 playwright-core/browsers.json）
    let expectedShellDir = null;
    try {
      const browsersJson = require.resolve('playwright-core/browsers.json', {
        paths: [__dirname, process.cwd()],
      });
      const browsers = JSON.parse(fs.readFileSync(browsersJson, 'utf8'));
      const shell = browsers.find((b) => b.name === 'chromium-headless-shell');
      if (shell) expectedShellDir = path.join(cache, `chromium_headless_shell-${shell.revision}`);
    } catch (_) { /* 解析失败则不启用回退 */ }

    if (expectedShellDir && fs.existsSync(expectedShellDir)) return null; // shell 齐全，无需回退

    // 取缓存中最新完整 chromium 的可执行文件
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const base = path.join(cache, dirs[i]);
      let inner;
      try { inner = fs.readdirSync(base); } catch (_) { continue; }
      const exeDir = inner.find((d) => d.startsWith('chrome-linux'));
      const exe = exeDir && path.join(base, exeDir, 'chrome');
      if (exe && fs.existsSync(exe)) return exe;
    }
  } catch (_) { /* 任何异常都保持原行为 */ }
  return null;
}

const chromiumFallback = resolveChromiumFallback();

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.playwright.test.js',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    // pre-commit / CI 默认无头；本地可 CI= npx playwright test 观察有头
    headless: !!process.env.CI || process.env.PRE_COMMIT === '1',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    ...(chromiumFallback ? { launchOptions: { executablePath: chromiumFallback } } : {}),
  },
});
