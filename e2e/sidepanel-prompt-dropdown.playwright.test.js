/**
 * 侧栏「提示词」下拉能拉下来：拉出的列表里真的有本机提示词（ADR-0167）。
 *
 * 背景：下拉菜单由 `sidepanel/agent-suggestions-panel.js` 按
 * `PageAdvisorPromptSkills.loadFromStorage()` 填。既有单测在 vm 里把
 * `PageAdvisorPromptSkills` 直接注进假 DOM 上下文，宿主页面到底有没有加载这个模块
 * 它看不见——`sidepanel.html` 漏掉脚本时用例照样全绿，用户看到的是只剩
 * 「默认提示词」一项的死下拉。这里把真实的 `sidepanel.html` 当普通扩展页加载
 * （假 chrome，真 DOM），补上「宿主真的把提示词画进下拉」这一段。
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

const TENANT = '884588082601422848';
const ACTIVE_TAB_ID = 1;

/** 登录后本机应有的一批提示词（工作空间同步下来的自定义技能）。 */
const STORED_SKILLS = [
  { id: 'sku-seo', title: 'SEO 标题优化', tendency: 'seo', body: '正文 SEO' },
  { id: 'sku-cvr', title: '转化率提升', tendency: 'conversion', body: '正文转化' },
];

/** 系统目录预埋（`lib/page-advisor-preset-skills.js` 的 BUNDLED_TENDENCIES）。 */
const BUNDLED_ID = 'sys_default_auto_innovate';
const BUNDLED_TITLE = '系统默认自动创新';
const DEFAULT_OPTION = '默认提示词';

/**
 * 假 chrome：给侧边栏脚本喂一份 `chrome.storage.local`（提示词就存在这里），
 * 并把出站消息暴露到 window 供用例断言。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ skills?: object[], activeSkillId?: string }} seed
 */
async function installStub(page, seed = {}) {
  await page.addInitScript(({ skills, activeSkillId, tabId }) => {
    try { localStorage.setItem('aidevpush.locale', 'zh-CN'); } catch (_) { /* ignore */ }
    const localStore = {
      'aidevpush.locale': 'zh-CN',
      ...(skills && skills.length ? { pageAdvisorPromptSkills: skills } : {}),
      ...(activeSkillId ? { pageAdvisorActiveSkillId: activeSkillId } : {}),
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
      if (action === 'listSitePendingForActiveTab' || action === 'refreshSitePendingForActiveTab') {
        return { success: true, items: [], count: 0, tabId };
      }
      if (action === 'getSidePanelOpenIntent') return { which: 'agent' };
      return {};
    };

    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '1.8.261', content_scripts: [{ js: [] }] }),
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
    skills: seed.skills || [],
    activeSkillId: seed.activeSkillId || '',
    tabId: ACTIVE_TAB_ID,
  });
}

/** 下拉里的全部 option：值 + 显示文案。 */
async function promptOptions(page) {
  return page.locator('#sp-agent-prompt option').evaluateAll((els) =>
    els.map((el) => ({ value: el.value, label: (el.textContent || '').trim() })));
}

test.describe('侧栏提示词下拉', () => {
  test('宿主页真的加载了提示词模块，下拉拉出的是本机提示词而不是只有默认项', async ({ page }) => {
    await installStub(page, { skills: STORED_SKILLS, activeSkillId: 'sku-cvr' });
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();
    await expect(page.locator('#sp-pane-agent')).toBeVisible();

    // 宿主页把提示词模块挂上了 window（漏挂脚本时这里是 undefined，下拉必然死）。
    const hasModule = await page.evaluate(() => typeof window.PageAdvisorPromptSkills === 'object'
      && typeof window.PageAdvisorPromptSkills.loadFromStorage === 'function');
    expect(hasModule).toBe(true);

    const opts = await promptOptions(page);
    const labels = opts.map((o) => o.label);
    // 默认项在首位，且本机两条提示词都在。
    expect(labels[0]).toBe(DEFAULT_OPTION);
    expect(labels).toContain('SEO 标题优化');
    expect(labels).toContain('转化率提升');
    expect(opts.find((o) => o.label === 'SEO 标题优化').value).toBe('sku-seo');
  });

  test('本机一条提示词都没有时，下拉至少还有系统默认那条，不是死的', async ({ page }) => {
    await installStub(page, {});
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();

    const opts = await promptOptions(page);
    const labels = opts.map((o) => o.label);
    expect(labels[0]).toBe(DEFAULT_OPTION);
    expect(labels).toContain(BUNDLED_TITLE);
  });

  test('选中一条提示词后点生成，消息带上这条提示词而不是退回默认', async ({ page }) => {
    await installStub(page, { skills: STORED_SKILLS, activeSkillId: 'sku-cvr' });
    await page.goto(SIDEPANEL_URL);
    await page.locator('#sp-tab-agent').click();

    // 用真实的用户操作选中（不直接写 value），顺带证明下拉里的项可被选中。
    await page.selectOption('#sp-agent-prompt', 'sku-seo');
    await page.locator('#sp-agent-generate').click();

    await expect.poll(async () => page.evaluate(() => {
      const m = (window.__sent || []).find((x) => x && x.action === 'generateAgentSuggestionsForActiveTab');
      return m ? { skillId: m.skillId, promptTendency: m.promptTendency } : null;
    })).toEqual({ skillId: 'sku-seo', promptTendency: 'seo' });
  });

  test('点一下下拉只派发一次 click，不会被外层 label 顶回来又立刻收起', async ({ page }) => {
    await installStub(page, { skills: STORED_SKILLS });
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
