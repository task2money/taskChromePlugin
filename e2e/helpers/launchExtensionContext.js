'use strict';

/**
 * Stable launchPersistentContext for MV3 extension e2e (OPT-20260918-027).
 *
 * Prefer cached Playwright chromium executablePath over flaky channel:'chromium'.
 * Callers should keep headless:false (MV3 SW) and run under xvfb when needed.
 * --disable-gpu avoids vaapi stalls observed on some hosts.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * @returns {string|null} Absolute path to chrome binary, or null.
 */
function resolveCachedChromiumExecutable() {
  try {
    const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
    if (!fs.existsSync(cache)) return null;
    const dirs = fs
      .readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort();
    for (let i = dirs.length - 1; i >= 0; i--) {
      const base = path.join(cache, dirs[i]);
      let inner;
      try {
        inner = fs.readdirSync(base);
      } catch (_) {
        continue;
      }
      const chromeDir = inner.find((d) => d.startsWith('chrome-linux'));
      const exe = chromeDir && path.join(base, chromeDir, 'chrome');
      if (exe && fs.existsSync(exe)) return exe;
    }
  } catch (_) {
    /* keep null */
  }
  return null;
}

/**
 * @param {import('@playwright/test').ChromiumBrowserType} chromium
 * @param {string} extensionPath Absolute path to unpacked extension root
 * @param {{ userDataDir?: string, headless?: boolean }} [opts]
 * @returns {Promise<import('@playwright/test').BrowserContext>}
 */
async function launchExtensionContext(chromium, extensionPath, opts = {}) {
  const userDataDir =
    opts.userDataDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskplugin-ext-e2e-'));
  const headless = opts.headless === true;
  const args = [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ];
  const base = {
    headless,
    args,
    timeout: opts.timeout || 60_000,
  };
  const exe = resolveCachedChromiumExecutable();
  if (exe) {
    return chromium.launchPersistentContext(userDataDir, {
      ...base,
      executablePath: exe,
    });
  }
  return chromium.launchPersistentContext(userDataDir, {
    ...base,
    channel: 'chromium',
  });
}

module.exports = {
  launchExtensionContext,
  resolveCachedChromiumExecutable,
};
