/**
 * 侧栏「提示词」下拉的数据源是服务端目录（Task 12）。
 *
 * 背景：下拉菜单由 `sidepanel/agent-suggestions-panel.js` 发后台消息
 * `loadPageAdvisorPromptOptions` 填充；选项来自 `{ok, skills, defaultSkillId, defaultTitle}`
 * 的投影，选中值记忆在 `pageAdvisorSelectedPromptId`，生成消息带 `promptSkillId`。
 * 既有单测在 vm 里用假 DOM，宿主页面到底有没有加载 `page-advisor-prompt-options.js`
 * 它看不见；这里把真实的 `sidepanel.html` 当普通扩展页加载（假 chrome，真 DOM），
 * 补上「宿主真的把服务端目录画进下拉、默认项/标记/顺序/生成字段都对」这一段。
 *
 * 运行：bash e2e/sidepanel-prompt-dropdown.playwright.test.js.sh
 */
const path = require('path');
const { pathToFileURL } = require('url');

function loadPlaywrightTest() {
  try {
    return require('@playwright/test');
  } catch (_) {
    return require(path.resolve(__dirname, '../../task2app/playwright/node_modules/@playwright/test'));
  }
}

const { test, expect } = loadPlaywrightTest();
const SIDEPANEL_URL = pathToFileURL(path.join(__dirname, '..', 'sidepanel', 'sidepanel.html')).href;

const ACTIVE_TAB_ID = 1;

/** 后台 loadPageAdvisorPromptOptions 的返回形状（真实服务端目录的投影）。 */
const SERVER_PROMPTS = {
  ok: true,
  defaultSkillId: 'seo-default',
  defaultTitle: '默认 SEO',
  skills: [
    {
      id: 'seo-default', title: '默认 SEO', tendency: 'seo', runtime: 'rewrite', source: 'catalog', readonly: true,
    },
    {
      id: 'seo-audit', title: '审计', tendency: 'seo', runtime: 'audit', source: 'catalog', readonly: true,
    },
    {
      id: 'ws-conv', title: '转化', tendency: 'conversion', runtime: 'rewrite', source: 'workspace', readonly: false,
    },
  ],
  partialError: false,
};

const DEFAULT_OPTION = '默认 · 默认 SEO';

/**
 * 假 chrome：给侧边栏脚本喂一份 `chrome.storage.local`（选中值记忆存在这里），
 * 并按真实契约回答 `loadPageAdvisorPromptOptions`；出站消息暴露到 window 供用例断言。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ promptOptions?: object, selectedId?: string }} seed
 */
async function installStub(page, seed = {}) {
  await page.addInitScript(({ promptOptions, selectedId, tabId }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = {
      'aidevpush.locale': 'zh-CN',
      ...(selectedId ? { pageAdvisorSelectedPromptId: selectedId } : {}),
    };
    const sessionStore = {};
    const storageListeners = [];
    const fire = (bag, area) => {
      const changes = {};
      Object.keys(bag).forEach((k) => { changes[k] = { newValue: bag[k] }; });
      storageListeners.forEach((fn) => fn(changes, area));
    };
    const area = (store, name) => ({
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: store[keys] };
        if (keys == null) return { ...store };
        const list = Array.isArray(keys) ? keys : Object.keys(keys);
        const out = {};
        for (const k of list) out[k] = store[k];
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
        fire(obj, name);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => { delete store[k]; });
      },
    });

    window.__localStore = localStore;
    window.__sent = [];
    window.__msgListeners = [];

    // Anti-Replay-OK: 测试桩，非业务写路径
    const reply = (message) => {
      const action = message && message.action;
      if (action === 'loadPageAdvisorPromptOptions') return promptOptions;
      if (action === 'listSitePendingForActiveTab' || action === 'refreshSitePendingForActiveTab') {
        return { success: true, items: [], count: 0, tabId };
      }
      if (action === 'getSidePanelOpenIntent') return { which: 'agent' };
      return {};
    };

    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.9.2', content_scripts: [{ js: [] }] }),
        getURL: (p) => p,
        id: 'test-ext',
        lastError: null,
        async sendMessage(message) {
          window.__sent.push(message);
          return reply(message);
        },
        onMessage: {
          addListener(fn) { window.__msgListeners.push(fn); },
          removeListener(fn) {
            const i = window.__msgListeners.indexOf(fn);
            if (i >= 0) window.__msgListeners.splice(i, 1);
          },
        },
      },
      storage: {
        local: area(localStore, 'local'),
        session: area(sessionStore, 'session'),
        onChanged: {
          addListener(fn) { storageListeners.push(fn); },
          removeListener(fn) {
            const i = storageListeners.indexOf(fn);
            if (i >= 0) storageListeners.splice(i, 1);
          },
        },
      },
      tabs: {
        async query() { return [{ id: tabId, url: 'https://aidevpush.com/pricing' }]; },
        async sendMessage() {},
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} },
      },
      sidePanel: { onOpened: { addListener() {} } },
      i18n: { getMessage: () => '' },
    };
  }, {
    promptOptions: seed.promptOptions || SERVER_PROMPTS,
    selectedId: seed.selectedId || '',
    tabId: ACTIVE_TAB_ID,
  });
}

/** 下拉里的全部 option：值 + 显示文案。 */
async function promptOptions(page) {
  return page.locator('#sp-agent-prompt option').evaluateAll((els) =>
    els.map((el) => ({ value: el.value, label: (el.textContent || '').trim() })));
}

test.describe('侧栏提示词下拉', () => {
  test('宿主页加载了服务端选项模块，下拉按目录顺序渲染默认项与条目', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();
    await expect(page.locator('#sp-pane-agent')).toBeVisible();

    // 宿主页把 PageAdvisorPromptOptions 挂上了 window（漏挂脚本时这里是 undefined，
    // 选中值记忆/清缓存都会静默失效）。
    const hasModule = await page.evaluate(() => typeof window.PageAdvisorPromptOptions === 'object'
      && typeof window.PageAdvisorPromptOptions.loadSelectedId === 'function');
    expect(hasModule).toBe(true);

    await expect(page.locator('#sp-agent-prompt option')).toHaveCount(3);
    const opts = await promptOptions(page);
    // 首项是默认项：value 为空，文案带服务端给的默认标题。
    expect(opts[0]).toEqual({ value: '', label: DEFAULT_OPTION });
    // 其余按服务端顺序渲染；默认 id 的重复项不再出现第二条。
    expect(opts.map((o) => o.value)).toEqual(['', 'seo-audit', 'ws-conv']);
    expect(opts.filter((o) => o.value === 'seo-default')).toHaveLength(0);
    expect(opts.filter((o) => o.label.startsWith('默认 SEO'))).toHaveLength(0);
    // 审计条目带「审计」标记，工作空间自定义带「工作空间」标记。
    expect(opts.find((o) => o.value === 'seo-audit').label).toContain('审计');
    expect(opts.find((o) => o.value === 'ws-conv').label).toContain('工作空间');
  });

  test('服务端目录为空时下拉只有默认项，不是死的也不算失败', async ({ page }) => {
    await installStub(page, {
      promptOptions: { ok: true, skills: [], defaultSkillId: '', defaultTitle: '', partialError: false },
    });
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();

    await expect(page.locator('#sp-agent-prompt option')).toHaveCount(1);
    const opts = await promptOptions(page);
    expect(opts).toEqual([{ value: '', label: '默认提示词' }]);
    // 空目录是成功响应：不报错、不露重试。
    await expect(page.locator('#sp-agent-prompt-status')).toHaveText('');
    await expect(page.locator('#sp-agent-prompt-retry')).toBeHidden();
  });

  test('选中工作空间提示词后点生成，消息带 promptSkillId 与 tendency', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();
    await expect(page.locator('#sp-agent-prompt option[value="ws-conv"]')).toHaveCount(1);

    // 用真实的用户操作选中（不直接写 value），顺带证明下拉里的项可被选中。
    await page.selectOption('#sp-agent-prompt', 'ws-conv');
    await page.locator('#sp-agent-generate').click();

    await expect.poll(async () => page.evaluate(() => {
      const m = (window.__sent || []).find((x) => x && x.action === 'generateAgentSuggestionsForActiveTab');
      return m ? { promptSkillId: m.promptSkillId, promptTendency: m.promptTendency } : null;
    })).toEqual({ promptSkillId: 'ws-conv', promptTendency: 'conversion' });

    const gen = await page.evaluate(() => (window.__sent || [])
      .find((x) => x && x.action === 'generateAgentSuggestionsForActiveTab'));
    // 本机 skillId 字段已退役，不再随生成消息发出。
    expect('skillId' in gen).toBe(false);
  });

  test('点一下下拉只派发一次 click，不会被外层 label 顶回来又立刻收起', async ({ page }) => {
    await installStub(page);
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();

    await page.evaluate(() => {
      window.__promptClicks = 0;
      document.getElementById('sp-agent-prompt')
        .addEventListener('click', () => { window.__promptClicks += 1; }, true);
    });

    const box = await page.locator('#sp-agent-prompt').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    const clicks = await page.evaluate(() => window.__promptClicks);
    expect(clicks).toBe(1);
  });
});
