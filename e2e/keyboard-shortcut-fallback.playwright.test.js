/**
 * 快捷键（Cmd/Ctrl+Shift+X）页内兜底 E2E（Playwright）
 *
 * 背景：chrome.commands 注册可能因 Mac 已知 bug / 键位冲突失败，此时按键事件穿透到
 * 页面。content.js 内置页内 keydown 兜底监听保证快捷键依然可用。
 * 兜底监听严格匹配 Popup「快捷键」选择（'cmd' 仅 ⌘+Shift+X，'ctrl' 仅 Ctrl+Shift+X），
 * 默认按操作系统；测试显式设置模式后验证组合生效与「另一组合不触发」。
 *
 * 验证（加载真实 lib 链 + content.js）：
 * 1. 页内 keydown 兜底：'cmd' 模式下合成 ⌘+Shift+X → 进入指针选择模式；再按 → 退出
 * 2. 浏览器命令路径（toggleElementPick 消息）依然可用
 * 3. 双触发保护：消息路径与 keydown 路径 300ms 内只生效一次
 * 4. 'ctrl' 模式下 Ctrl+Shift+X 生效，且 ⌘+Shift+X 被严格忽略
 */

const path = require('path');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../AiDevGrafana/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();

const ROOT = path.resolve(__dirname, '..');

/** 与 manifest.json content_scripts 相同的加载顺序 */
const LIB_FILES = [
  'lib/storage.js',
  'lib/dom-trace.js',
  'lib/create-task-git-identity.js',
  'lib/create-task-payload.js',
  'lib/element-picker.js',
  'lib/user-guide.js',
  'lib/float-workspace-select.js',
  'lib/float-panel-after-create.js',
  'lib/aidev-meta.js',
  'content/content.js',
];

/** 注入 chrome API stubs（必须在页面脚本之前） */
function installChromeStubs() {
  return `
    window.__onMessageHandlers = [];
    window.__storageOnChangedListeners = [];
    window.chrome = {
      runtime: {
        sendMessage: async (msg, cb) => {
          let data = {
            baseUrl: 'https://aidevpush.com',
            token: '',
            username: '',
            userId: '',
            memberId: '',
            expired: false,
            loggedIn: false,
            remainingSeconds: 0,
            expiryHint: null,
          };
          if (msg && msg.action === 'getAuthStatus') {
            data = { ...data, loggedIn: false, token: '' };
          }
          const resp = { success: true, data };
          if (typeof cb === 'function') cb(resp);
          return resp;
        },
        onMessage: {
          addListener(fn) { window.__onMessageHandlers.push(fn); },
        },
        lastError: null,
      },
      storage: {
        local: {
          _store: { floatBallEnabled: true, trackingEnabled: false },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          // set 触发 storage.onChanged（OPT-20260806-015）：模拟真实 chrome.storage
          // 语义，页内「直接写 storage → 模式实时切换」路径可端到端验证
          async set(obj) {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) {
              changes[k] = { newValue: v, oldValue: this._store[k] };
              this._store[k] = v;
            }
            if (Object.keys(changes).length > 0) {
              for (const fn of window.__storageOnChangedListeners) {
                try { fn(changes, 'local'); } catch (_) {}
              }
            }
          },
          async remove() {},
        },
        session: {
          async get() { return {}; },
          async set() {},
        },
        onChanged: {
          addListener(fn) { window.__storageOnChangedListeners.push(fn); },
        },
      },
      dom: { openOrClosedShadowRoot() { return null; } },
    };
  `;
}

/** 模拟浏览器级 chrome.commands 命令：向页面所有 onMessage 监听器派发消息 */
function dispatchRuntimeMessage(handlerListExpr, messageExpr) {
  return `(function () {
    const msg = ${messageExpr};
    let debounced = false;
    for (const fn of window.${handlerListExpr}) {
      try { fn(msg, { tab: { id: 1 } }, (resp) => { if (resp && resp.debounced) debounced = true; }); } catch (_) {}
    }
    return debounced;
  })()`;
}

/** 合成 ⌘+Shift+X 页内按键（浏览器级命令注册失败时按键会穿透到页面） */
function dispatchCmdShortcutKey() {
  return `(function () {
    const ev = new KeyboardEvent('keydown', {
      key: 'x',
      code: 'KeyX',
      keyCode: 88,
      which: 88,
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
  })()`;
}

/** 合成 Ctrl+Shift+X 页内按键 */
function dispatchCtrlShortcutKey() {
  return `(function () {
    const ev = new KeyboardEvent('keydown', {
      key: 'X',
      code: 'KeyX',
      keyCode: 88,
      which: 88,
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
  })()`;
}

/**
 * OPT-20260806-047: 通用组合串合成器 — 按组合串生成任意修饰键组合的 keydown。
 * 例：'Alt+Shift+E' → altKey+shiftKey+key 'e'；'Ctrl+Shift+X' → 与 dispatchCtrlShortcutKey 等价。
 */
function dispatchComboShortcutKey(combo) {
  const parts = String(combo || '').split('+').map((p) => p.trim()).filter(Boolean)
  const keyName = parts[parts.length - 1]
  const mods = new Set(parts.slice(0, -1))
  return `(function () {
    const ev = new KeyboardEvent('keydown', {
      key: '${keyName.toLowerCase()}',
      code: 'Key${keyName.toUpperCase()}',
      keyCode: ${keyName.toUpperCase().charCodeAt(0)},
      which: ${keyName.toUpperCase().charCodeAt(0)},
      ctrlKey: ${mods.has('Ctrl')},
      altKey: ${mods.has('Alt')},
      shiftKey: ${mods.has('Shift')},
      metaKey: ${mods.has('Command')},
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(ev);
  })()`;
}

/** 切换自定义组合串：只写 storage 并触发 onChanged（不再派发跨 tab 消息） */
function setShortcutCombo(combo) {
  return `(function () {
    const old = window.chrome.storage.local._store.elementPickerShortcut;
    window.chrome.storage.local._store.elementPickerShortcut = ${JSON.stringify(combo)};
    const changes = { elementPickerShortcut: { newValue: ${JSON.stringify(combo)}, oldValue: old } };
    for (const fn of window.__storageOnChangedListeners) {
      try { fn(changes, 'local'); } catch (_) {}
    }
  })()`;
}

/**
 * 模拟 Popup/SW 切换快捷键：写入 storage stub + 触发 storage.onChanged。
 */
function setShortcutMode(mode) {
  return `(function () {
    const old = window.chrome.storage.local._store.elementPickerShortcut;
    window.chrome.storage.local._store.elementPickerShortcut = ${JSON.stringify(mode)};
    const changes = { elementPickerShortcut: { newValue: ${JSON.stringify(mode)}, oldValue: old } };
    for (const fn of window.__storageOnChangedListeners) {
      try { fn(changes, 'local'); } catch (_) {}
    }
  })()`;
}

async function loadPluginIntoPage(page) {
  // 注意：本环境 Playwright 的 addInitScript 在 setContent 文档上不生效，
  // 需先 goto 空白页（init script 会在该文档运行），再注入页面内容与脚本
  await page.addInitScript(installChromeStubs());
  await page.goto('about:blank');
  await page.evaluate(
    `document.body.innerHTML = '<h1>Shortcut Fallback Test</h1><p>content</p>';`,
  );
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  // 悬浮球可能因配置隐藏，仅需保证 DOM 已挂载（断言基于类名/文本，不依赖可见性）
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 10000 });
}

/** 读取指针选择模式状态：documentElement 类 + 悬浮球按钮文本 */
async function pickState(page) {
  return page.evaluate(() => {
    const btn = document.getElementById('taskplugin-float-btn');
    return {
      on: document.documentElement.classList.contains('taskplugin-picking'),
      btnText: btn ? btn.textContent : null,
    };
  });
}

async function waitPickState(page, expectedOn) {
  await page.waitForFunction((wantOn) => {
    const btn = document.getElementById('taskplugin-float-btn');
    const on = document.documentElement.classList.contains('taskplugin-picking');
    return wantOn ? (on && btn && btn.textContent === '✕') : (!on && btn && btn.textContent === '+');
  }, expectedOn, { timeout: 5000 });
}

test.describe('快捷键页内兜底', () => {
  test('chrome.commands 注册失败时：「cmd」模式下页内 ⌘+Shift+X 可进入/退出指针选择模式', async ({ page }) => {
    await loadPluginIntoPage(page);
    await page.evaluate(setShortcutMode('cmd'));

    // 初始：未选择模式
    expect(await pickState(page)).toEqual({ on: false, btnText: '+' });

    // 第一次 ⌘+Shift+X → 进入指针选择模式
    await page.evaluate(dispatchCmdShortcutKey());
    await waitPickState(page, true);
    expect((await pickState(page)).on).toBe(true);

    // 去抖窗口（300ms）内的重复按键应被忽略，不产生双切换
    await page.evaluate(dispatchCmdShortcutKey());
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(true);

    // 窗口过后再次按键 → 退出指针选择模式
    await page.waitForTimeout(350);
    await page.evaluate(dispatchCmdShortcutKey());
    await waitPickState(page, false);
    expect((await pickState(page)).on).toBe(false);
  });

  test('浏览器命令路径（toggleElementPick 消息）依然可用', async ({ page }) => {
    await loadPluginIntoPage(page);

    // 模拟 chrome.commands.onCommand → SW → tabs.sendMessage
    const debounced1 = await page.evaluate(
      dispatchRuntimeMessage('__onMessageHandlers', `{ action: 'toggleElementPick' }`),
    );
    expect(debounced1).toBe(false);
    await waitPickState(page, true);

    // 去抖窗口内消息路径自身再次触发 → 返回 debounced 回执且不切换
    const debounced2 = await page.evaluate(
      dispatchRuntimeMessage('__onMessageHandlers', `{ action: 'toggleElementPick' }`),
    );
    expect(debounced2).toBe(true);
    expect((await pickState(page)).on).toBe(true);

    // 窗口过后再次触发 → 正常切换退出
    await page.waitForTimeout(350);
    await page.evaluate(dispatchRuntimeMessage('__onMessageHandlers', `{ action: 'toggleElementPick' }`));
    await waitPickState(page, false);
  });

  test('双触发保护：同一次按键的 keydown 与浏览器命令只生效一次', async ({ page }) => {
    await loadPluginIntoPage(page);
    await page.evaluate(setShortcutMode('cmd'));

    // 场景 A：keydown 先到（页面兜底处理），随后浏览器命令消息到达 → 应被忽略
    await page.evaluate(dispatchCmdShortcutKey());
    await waitPickState(page, true);
    const debouncedA = await page.evaluate(
      dispatchRuntimeMessage('__onMessageHandlers', `{ action: 'toggleElementPick' }`),
    );
    expect(debouncedA).toBe(true);
    expect((await pickState(page)).on).toBe(true);

    // 场景 B：浏览器命令先到，随后 keydown 穿透 → keydown 应被忽略
    await page.waitForTimeout(350); // 离开去抖窗口
    await page.evaluate(dispatchRuntimeMessage('__onMessageHandlers', `{ action: 'toggleElementPick' }`));
    await waitPickState(page, false);
    await page.evaluate(dispatchCmdShortcutKey()); // 紧接 keydown 穿透
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(false);

    // 窗口过后正常退出/恢复
    await page.waitForTimeout(350);
    await page.evaluate(dispatchCmdShortcutKey());
    await waitPickState(page, true);
  });

  test('「ctrl」模式下 Ctrl+Shift+X 生效，⌘+Shift+X 被严格忽略', async ({ page }) => {
    await loadPluginIntoPage(page);
    await page.evaluate(setShortcutMode('ctrl'));

    // 严格匹配：'ctrl' 模式下按 ⌘+Shift+X 不触发
    await page.evaluate(dispatchCmdShortcutKey());
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(false);

    // Ctrl+Shift+X（Windows/Linux 修饰键）生效
    await page.evaluate(dispatchCtrlShortcutKey());
    await waitPickState(page, true);
    expect((await pickState(page)).on).toBe(true);
  });

  test('直接写 storage（onChanged 实时路径，不依赖消息广播）→ 页内模式实时切换', async ({ page }) => {
    await loadPluginIntoPage(page);
    // 初始：无自定义模式（默认按系统），'cmd' 组合也不触发
    await page.evaluate(dispatchCmdShortcutKey());
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(false);

    // 仅直接写 storage.local（chrome.storage.set 触发 onChanged），不派发任何消息：
    // 页内 bindPickShortcutStorageListener 应实时生效（OPT-20260806-015，
    // 此前该路径仅靠静态断言覆盖，stub onChanged 为 no-op）
    await page.evaluate(`chrome.storage.local.set({ elementPickerShortcut: 'cmd' })`);
    await page.evaluate(dispatchCmdShortcutKey());
    await waitPickState(page, true);
    expect((await pickState(page)).on).toBe(true);

    // 再次直接写 storage 切换为 'ctrl'：⌘+Shift+X 立即失效（被忽略，状态不变）
    await page.waitForTimeout(350); // 离开去抖窗口
    await page.evaluate(`chrome.storage.local.set({ elementPickerShortcut: 'ctrl' })`);
    await page.evaluate(dispatchCmdShortcutKey());
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(true);

    // Ctrl+Shift+X 生效 → 退出选择模式
    await page.evaluate(dispatchCtrlShortcutKey());
    await waitPickState(page, false);
  });

  // ── OPT-20260806-047: 自定义组合串全链路（Alt+Shift+E 等任意组合） ──
  test('自定义组合 Alt+Shift+E：进入/退出指针选择，其他修饰键组合被严格忽略', async ({ page }) => {
    await loadPluginIntoPage(page);
    // 初始：无自定义模式（默认按系统），Alt+Shift+E 不应触发
    await page.evaluate(dispatchComboShortcutKey('Alt+Shift+E'));
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(false);

    // 切换为 Alt+Shift+E → 页内严格匹配该组合
    await page.evaluate(setShortcutCombo('Alt+Shift+E'));

    // Alt+Shift+E → 进入指针选择模式
    await page.evaluate(dispatchComboShortcutKey('Alt+Shift+E'));
    await waitPickState(page, true);

    // 严格忽略：Ctrl+Shift+E / ⌘+Shift+E / Ctrl+Alt+E 均不触发（未列出的修饰键不得按下）
    for (const combo of ['Ctrl+Shift+E', 'Command+Shift+E', 'Ctrl+Alt+E', 'Alt+Shift+X']) {
      await page.evaluate(dispatchComboShortcutKey(combo));
      await page.waitForTimeout(50);
      expect((await pickState(page)).on, `${combo} must not trigger`).toBe(true);
    }

    // 再次 Alt+Shift+E → 退出选择模式
    await page.waitForTimeout(350); // 离开去抖窗口
    await page.evaluate(dispatchComboShortcutKey('Alt+Shift+E'));
    await waitPickState(page, false);
  });

  test('storage onChanged 实时切换到自定义组合：旧组合立即失效、新组合生效', async ({ page }) => {
    await loadPluginIntoPage(page);

    // 直接写 storage（onChanged 实时路径）切换为 Alt+Shift+E
    await page.evaluate(`chrome.storage.local.set({ elementPickerShortcut: 'Alt+Shift+E' })`);
    await page.evaluate(dispatchComboShortcutKey('Alt+Shift+E'));
    await waitPickState(page, true);

    // 实时切换为 Ctrl+Alt+P：Alt+Shift+E 立即失效（状态保持，不退出）
    await page.waitForTimeout(350);
    await page.evaluate(`chrome.storage.local.set({ elementPickerShortcut: 'Ctrl+Alt+P' })`);
    await page.evaluate(dispatchComboShortcutKey('Alt+Shift+E'));
    await page.waitForTimeout(100);
    expect((await pickState(page)).on).toBe(true);

    // 新组合 Ctrl+Alt+P 生效 → 退出选择模式
    await page.evaluate(dispatchComboShortcutKey('Ctrl+Alt+P'));
    await waitPickState(page, false);
  });
});
