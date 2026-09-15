/**
 * 建议卡悬停高亮宿主页锚点（OPT-20260915-024）
 *
 * 单测只覆盖 class 绑定与切换；层叠 / pointer-events / !important 注入样式
 * 只有在真实浏览器里才可确认。本用例断言：
 * 1. mouseenter 建议卡 → 对应 target_nid 锚点获得 `.taskplugin-advisor-region-highlight`
 *    且计算样式确为 2px solid（证明注入的 !important 规则生效）
 * 2. 跨卡切换：前一张卡的锚点高亮被清除，新卡锚点被高亮
 * 3. 无锚点（无 nid / anchor_text 不匹配）的角落卡 mouseenter 不抛错且不残留高亮
 * 4. mouseleave（鼠标移到卡外）后高亮清除
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

/** 与 manifest content_scripts[0].js 对齐的最小可启动链（含 region advisor） */
const LIB_FILES = [
  'lib/content-boot-gate.js',
  'lib/storage.js',
  'lib/dom-trace.js',
  'lib/create-task-git-identity.js',
  'lib/branch-datalist.js',
  'lib/create-task-payload.js',
  'lib/element-picker.js',
  'lib/plugin-brand.js',
  'lib/user-guide.js',
  'lib/float-workspace-select.js',
  'lib/workspace-list.js',
  'lib/workspace-members.js',
  'lib/float-members-ui.js',
  'lib/project-auto-run-label.js',
  'lib/workspace-auto-schedule.js',
  'lib/float-panel-markup.js',
  'lib/float-panel-after-create.js',
  'lib/aidev-meta.js',
  'lib/hot-path-guards.js',
  'lib/visibility-interval.js',
  'lib/auth-refresh-debounce.js',
  'lib/page-context.js',
  'lib/page-advisor-region.js',
  'lib/page-advisor-a11y.js',
  'lib/page-advisor-fill.js',
  'lib/page-advisor-preview.js',
  'lib/page-advisor-defaults.js',
  'lib/page-advisor-card-layout.js',
  'lib/float-last-selection.js',
  'lib/click-guard.js',
  'lib/is-auth-route.js',
  'lib/dialog-focus-trap.js',
  'content/float-boot.js',
  'content/float-pick.js',
  'content/float-drag-auth.js',
  'content/float-aidev.js',
  'content/float-form.js',
  'content/float-snapshot.js',
  'content/float-page-advisor-region.js',
  'content/float-page-advisor-layer.js',
  'content/float-page-advisor-drag.js',
  'content/float-page-advisor.js',
  'content/content.js',
];

const HIGHLIGHT_CLASS = 'taskplugin-advisor-region-highlight';

function installChromeStubs() {
  return `
    window.__onMessageHandlers = [];
    window.__storageOnChangedListeners = [];
    window.__sentMessages = [];
    window.chrome = {
      runtime: {
        sendMessage: async (msg, cb) => {
          window.__sentMessages.push(msg);
          let data = {
            baseUrl: 'https://aidevpush.com',
            token: 't',
            username: 'u',
            userId: '1',
            memberId: '',
            expired: false,
            loggedIn: true,
            remainingSeconds: 3600,
            expiryHint: null,
          };
          if (msg && msg.action === 'getAuthStatus') {
            data = { ...data, loggedIn: true, token: 't' };
          }
          if (msg && msg.action === 'getFloatBallConfig') {
            data = { enabled: true };
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
          _store: {
            floatBallEnabled: true,
            trackingEnabled: false,
            workspaceId: 'ws_test',
            tenantId: '1',
          },
          async get(keys) {
            const list = Array.isArray(keys) ? keys : [keys];
            const out = {};
            for (const k of list) out[k] = this._store[k];
            return out;
          },
          async set(obj) {
            Object.assign(this._store, obj);
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

async function loadPluginIntoPage(page) {
  await page.addInitScript(installChromeStubs());
  await page.goto('about:blank');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <h1 id="host-title" data-taskplugin-nid="host-title">Host Page Title</h1>
      <p id="host-para" data-taskplugin-nid="host-para">HOST_PAGE_TEXT_UNIQUE</p>
      <div id="host-side" data-taskplugin-nid="host-side">HOST_SIDE_UNIQUE</div>
    `;
  });
  for (const rel of LIB_FILES) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }
  // 与 manifest content_scripts[0].css 对齐 —— 建议卡尺寸来自 page-advisor.css，
  // 缺样式时卡宽为 0，Playwright 判定不可见，悬停/布局类用例无法成立。
  for (const rel of [
    'content/content.css',
    'content/content-form.css',
    'content/page-advisor.css',
    'content/content-region.css',
    'content/content-guide.css',
  ]) {
    await page.addStyleTag({ path: path.join(ROOT, rel) });
  }
  await page.waitForSelector('#taskplugin-float-btn', { state: 'attached', timeout: 15000 });
}

/** 注入三条建议：s1→host-para，s2→host-side，s3 无任何可解析锚点（角落卡） */
async function showSuggestions(page) {
  await page.evaluate(() => {
    showPageAdvisorSuggestions({
      suggestions: [
        { id: 's1', title: '标题建议', summary: '摘要一', target_nid: 'host-para' },
        { id: 's2', title: '侧栏建议', summary: '摘要二', target_nid: 'host-side' },
        {
          id: 's3',
          title: '全局建议',
          summary: '摘要三',
          target_nid: 'nid-does-not-exist',
          anchor_text: 'NO_SUCH_ANCHOR_TEXT_IN_PAGE_ZZZ',
        },
      ],
      pageUrl: 'https://example.test/page',
      jobId: 'job-1',
    });
  });
  await page.waitForSelector('.taskplugin-page-advisor-float-card', { timeout: 8000 });
}

/**
 * 把真实鼠标移到目标卡上一个**未被其它卡遮挡**的点，触发 mouseenter。
 * 建议卡在视口拥挤时会互相重叠，`page.hover()` 要求命中点元素可交互，
 * 重叠时会因指针被上层卡拦截而反复重试，故用 elementFromPoint 自选命中点。
 */
async function moveMouseIntoCard(page, sid) {
  const pt = await page.evaluate((sid) => {
    const card = document.querySelector(
      `.taskplugin-page-advisor-float-card[data-sid="${sid}"]`,
    );
    if (!card) return null;
    const r = card.getBoundingClientRect();
    for (let y = r.top + 3; y < r.bottom - 3; y += 3) {
      for (let x = r.left + 3; x < r.right - 3; x += 3) {
        const el = document.elementFromPoint(x, y);
        if (el && card.contains(el)) return { x, y };
      }
    }
    return null;
  }, sid);
  expect(pt, `no clickable point for card ${sid}`).not.toBeNull();
  await page.mouse.move(pt.x, pt.y);
}

/** 找一个不落在任何建议卡矩形内的视口坐标（用于触发 mouseleave） */
async function findPointOutsideCards(page) {
  return page.evaluate(() => {
    const rects = Array.from(
      document.querySelectorAll('.taskplugin-page-advisor-float-card'),
    ).map((c) => c.getBoundingClientRect());
    for (let y = 4; y < window.innerHeight; y += 16) {
      for (let x = 4; x < window.innerWidth; x += 16) {
        const inside = rects.some(
          (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
        );
        if (!inside) return { x, y };
      }
    }
    return null;
  });
}

/** 读取锚点高亮的 class + 计算样式（计算样式证明注入的 !important 规则真的生效） */
function readHighlight(page, nid) {
  return page.evaluate(
    ({ nid, cls }) => {
      const el = document.querySelector(`[data-taskplugin-nid="${nid}"]`);
      if (!el) return { found: false };
      const cs = window.getComputedStyle(el);
      return {
        found: true,
        hasClass: el.classList.contains(cls),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outOfFloatRoot: !el.closest('#taskplugin-float-root'),
      };
    },
    { nid, cls: HIGHLIGHT_CLASS },
  );
}

test.describe('建议卡悬停高亮宿主页锚点', () => {
  test('hover 高亮 target_nid 锚点，跨卡切换与 mouseleave 正确清除', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err && err.message)));

    await loadPluginIntoPage(page);
    await showSuggestions(page);

    // 渲染后焦点陷阱可能已把焦点放到首张卡（focusin 亦会高亮）。清零到已知起点，
    // 同时覆盖 focusout 清除契约。
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });
    await page.waitForFunction(
      (cls) => document.querySelectorAll(`.${cls}`).length === 0,
      HIGHLIGHT_CLASS,
      { timeout: 4000 },
    );
    expect((await readHighlight(page, 'host-para')).hasClass).toBe(false);

    // 悬停 s1 → host-para 高亮，且注入样式在真实浏览器中生效
    await moveMouseIntoCard(page, 's1');
    await page.waitForFunction(
      ({ nid, cls }) =>
        !!document
          .querySelector(`[data-taskplugin-nid="${nid}"]`)
          ?.classList.contains(cls),
      { nid: 'host-para', cls: HIGHLIGHT_CLASS },
      { timeout: 4000 },
    );
    const first = await readHighlight(page, 'host-para');
    expect(first.hasClass).toBe(true);
    expect(first.outlineStyle).toBe('solid');
    expect(first.outlineWidth).toBe('2px');
    // 锚点属于宿主页，不应落在扩展浮窗内部（层叠/pointer-events 前提）
    expect(first.outOfFloatRoot).toBe(true);

    // 跨卡切换：悬停 s2 → s1 锚点清除，host-side 高亮
    await moveMouseIntoCard(page, 's2');
    await page.waitForFunction(
      ({ nid, cls }) =>
        !!document
          .querySelector(`[data-taskplugin-nid="${nid}"]`)
          ?.classList.contains(cls),
      { nid: 'host-side', cls: HIGHLIGHT_CLASS },
      { timeout: 4000 },
    );
    expect((await readHighlight(page, 'host-para')).hasClass).toBe(false);
    expect((await readHighlight(page, 'host-side')).hasClass).toBe(true);

    // 无锚点角落卡：mouseenter 不抛错、不残留高亮
    await moveMouseIntoCard(page, 's3');
    const stray = await page.evaluate(
      (cls) => document.querySelectorAll(`.taskplugin-advisor-region-highlight`).length,
      HIGHLIGHT_CLASS,
    );
    expect(stray).toBe(0);
    expect((await readHighlight(page, 'host-side')).hasClass).toBe(false);

    // 悬停回 s1 再移出卡外 → 高亮清除
    await moveMouseIntoCard(page, 's1');
    await page.waitForFunction(
      ({ nid, cls }) =>
        !!document
          .querySelector(`[data-taskplugin-nid="${nid}"]`)
          ?.classList.contains(cls),
      { nid: 'host-para', cls: HIGHLIGHT_CLASS },
      { timeout: 4000 },
    );
    const outside = await findPointOutsideCards(page);
    expect(outside).not.toBeNull();
    await page.mouse.move(outside.x, outside.y);
    await page.waitForFunction(
      ({ nid, cls }) =>
        !document
          .querySelector(`[data-taskplugin-nid="${nid}"]`)
          ?.classList.contains(cls),
      { nid: 'host-para', cls: HIGHLIGHT_CLASS },
      { timeout: 4000 },
    );
    expect((await readHighlight(page, 'host-para')).hasClass).toBe(false);

    expect(pageErrors).toEqual([]);
  });
});
