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
 * Temp profiles this process created and still owes a cleanup for.
 *
 * Constraint 44: test temp resources must not outlive the run. Scoped to this
 * process only — never sweep the shared `taskplugin-ext-e2e-*` prefix, since
 * concurrent runners own sibling dirs.
 */
const ownedTempProfiles = new Set();
let exitHookInstalled = false;

function removeOwnedTempProfile(dir) {
  if (!ownedTempProfiles.delete(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    /* best effort: a locked profile must not fail the test run */
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const dir of [...ownedTempProfiles]) removeOwnedTempProfile(dir);
  });
}

/**
 * Remove a helper-created profile once its context closes, with a process-exit
 * sweep as backstop for crashed or never-closed runs.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} userDataDir
 */
function attachTempProfileCleanup(context, userDataDir) {
  ownedTempProfiles.add(userDataDir);
  installExitHook();

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    removeOwnedTempProfile(userDataDir);
  };

  let originalClose;
  try {
    originalClose = context.close;
  } catch (_) {
    originalClose = null;
  }
  if (typeof originalClose !== 'function') {
    if (typeof context.once === 'function') context.once('close', cleanup);
    return context;
  }
  try {
    const bound = originalClose.bind(context);
    context.close = async (...args) => {
      try {
        return await bound(...args);
      } finally {
        cleanup();
      }
    };
  } catch (_) {
    if (typeof context.once === 'function') context.once('close', cleanup);
  }
  return context;
}

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
  const ownsUserDataDir = !opts.userDataDir;
  const userDataDir =
    opts.userDataDir ||
    fs.mkdtempSync(path.join(os.tmpdir(), 'taskplugin-ext-e2e-'));
  if (ownsUserDataDir) {
    ownedTempProfiles.add(userDataDir);
    installExitHook();
  }
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
  let context;
  try {
    context = exe
      ? await chromium.launchPersistentContext(userDataDir, {
          ...base,
          executablePath: exe,
        })
      : await chromium.launchPersistentContext(userDataDir, {
          ...base,
          channel: 'chromium',
        });
  } catch (err) {
    // A launch that never produced a context would otherwise strand the profile.
    if (ownsUserDataDir) removeOwnedTempProfile(userDataDir);
    throw err;
  }
  if (ownsUserDataDir) attachTempProfileCleanup(context, userDataDir);
  return context;
}

module.exports = {
  launchExtensionContext,
  resolveCachedChromiumExecutable,
};
