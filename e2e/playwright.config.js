'use strict';

const path = require('path');

function resolvePlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    const fallback = path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test');
    return require(fallback);
  }
}

const { defineConfig } = resolvePlaywrightTest();

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
  },
});
