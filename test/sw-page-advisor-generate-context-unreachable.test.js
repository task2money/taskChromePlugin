'use strict';

/**
 * 采集页面上下文联系不上 content script 时的行为（侧边栏「给当前网页生成建议」的失败出口）。
 * 一个回归套件覆盖两个模块：
 * - `background/sw-page-advisor.js` 的 askContentPageAdvisorContext：失败分类、重试、文案
 * - `background/sw-page-advisor-generate.js`：错误码与文案原样透传，本地挡住时不发请求
 *
 * 场景：
 * - 页面还在加载：等一下再重试（用户点早了，不该判死）
 * - 页面已加载完且联系不上（插件刚更新/安装前就开着的页面）：给可执行文案 + 稳定错误码，
 *   而不是把 `Could not establish connection` 直接抛上去
 * - 浏览器内置页 / 扩展页 / 应用商店 / 本地文件页：压根注入不了，单独文案（刷新也没用）
 */

const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const DEAD_CHANNEL = 'Could not establish connection. Receiving end does not exist.';

function loadStack(extraSandbox = {}) {
  const sandbox = {
    console,
    // vm 新 realm 没有宿主定时器；采集重试用 setTimeout，按真实 SW 环境补齐。
    setTimeout,
    clearTimeout,
    chrome: {
      tabs: {
        query: async () => [{ id: 1 }],
        get: async () => ({ id: 1 }),
        sendMessage: async () => ({ success: true, data: {} }),
      },
      commands: { getAll: async () => [], update: async () => {} },
    },
    Storage: {
      migrateStaleTokenExpiryOnce: async () => {},
      getApiConfig: async () => ({ token: 't', baseUrl: 'https://example.test' }),
      getEndpointMapping: async () => ({}),
      getCredentials: async () => ({}),
      isTokenExpired: async () => false,
      getLastWorkspace: async () => '',
    },
    API: {
      init: () => {},
      setOwner: () => {},
      getWorkspaces: async () => [],
      getBaseUrl: () => 'https://example.test',
      getToken: () => 't',
    },
    PageAdvisorDefaults: {
      resolvePageAdvisorWorkspace: () => ({ workspaceId: 'ws1', companyId: 'ten1', source: 'test' }),
    },
    PageAdvisorLlmConfig: {
      loadFromStorage: async () => ({ apiKey: '', baseUrl: '', model: '', routeMode: 'saas' }),
      resolveRoute: (cfg) => (cfg && cfg.routeMode === 'direct' ? 'direct' : 'saas'),
      isDirectLlmReady: () => false,
    },
    ClickGuard: { newIdempotencyKey: () => 'idem-key' },
    ...extraSandbox,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  require('./helpers/txRuntime.js').installTxInSandbox(sandbox);

  for (const rel of [
    'lib/api-http.js',
    'lib/page-advisor-api.js',
    'lib/page-advisor-fail-trace-id.js',
    'lib/page-advisor-timing.js',
    'background/sw-page-advisor-timing-run.js',
    'background/sw-page-advisor-generate.js',
    'background/sw-page-advisor.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, rel), 'utf8'),
      sandbox,
      { filename: path.basename(rel) },
    );
  }
  return sandbox;
}

/** 死信道 tab：sendMessage 一律抛「接收端不存在」，如实况。 */
function deadChannelTab(url, status) {
  return {
    id: 1,
    url,
    status,
    sendMessage: async (_tabId, msg) => {
      if (msg && msg.action === 'getPageAdvisorContext') throw new Error(DEAD_CHANNEL);
      return undefined;
    },
  };
}

/** chrome.tabs 假件：query/get 给 tab 元信息，sendMessage 转发给 tab 自己的信道。 */
function chromeForTab(tab) {
  return {
    tabs: {
      query: async () => [tab],
      get: async () => tab,
      sendMessage: async (tabId, msg, opts) => (typeof tab.sendMessage === 'function'
        ? tab.sendMessage(tabId, msg, opts)
        : undefined),
    },
  };
}

/** 按测试需要调小重试预算的栈（真实 SW 用文件里的默认值）。 */
function stackWithTab(tab) {
  const sandbox = loadStack({ chrome: chromeForTab(tab) });
  sandbox.PAGE_ADVISOR_CONTEXT_WAIT_READY_MS = 80;
  sandbox.PAGE_ADVISOR_CONTEXT_WAIT_LOADING_MS = 80;
  sandbox.PAGE_ADVISOR_CONTEXT_POLL_MS = 10;
  return sandbox;
}

describe('askContentPageAdvisorContext 失败分类与重试', () => {
  it('页面加载中：等 content script 注入完成后重试成功', async () => {
    const tab = deadChannelTab('https://shop.test/p', 'loading');
    let sent = 0;
    const sandbox = loadStack({ chrome: chromeForTab(tab) });
    sandbox.PAGE_ADVISOR_CONTEXT_WAIT_LOADING_MS = 3000;
    sandbox.PAGE_ADVISOR_CONTEXT_POLL_MS = 10;
    sandbox.chrome.tabs.sendMessage = async (_tabId, msg) => {
      if (msg.action !== 'getPageAdvisorContext') return undefined;
      sent += 1;
      // 前两次：脚本还没注入（frame0 + 整 tab 广播都打不通）。
      if (sent <= 2) throw new Error(DEAD_CHANNEL);
      return { success: true, data: { url: 'https://shop.test/p', title: '商品页', pageText: 'x' } };
    };

    const resp = await sandbox.askContentPageAdvisorContext(1);

    assert.equal(resp?.success, true, '应在重试后拿到上下文');
    assert.equal(resp.data.title, '商品页');
    assert.ok(sent >= 3, `应重试过，实际 sendMessage 次数 ${sent}`);
  });

  it('页面已加载完但联系不上：返回带错误码的失败对象而不是抛异常', async () => {
    const sandbox = stackWithTab(deadChannelTab('https://shop.test/p', 'complete'));

    const resp = await sandbox.askContentPageAdvisorContext(1);

    assert.ok(resp && typeof resp === 'object', '不能抛异常，要返回响应对象');
    assert.equal(resp.success, false);
    assert.equal(resp.errorCode, 'PAGE_CONTEXT_UNREACHABLE');
    assert.equal(resp.error, sandbox.tx('paContextUnreachable'));
    assert.match(resp.error, /刷新/, '文案要给出可执行动作');
  });

  it('页面还在加载但始终等不到：预算内收尾，不无限等', async () => {
    const sandbox = stackWithTab(deadChannelTab('https://shop.test/p', 'loading'));
    const t0 = Date.now();

    const resp = await sandbox.askContentPageAdvisorContext(1);

    assert.equal(resp.errorCode, 'PAGE_CONTEXT_UNREACHABLE');
    assert.ok(Date.now() - t0 < 2000, `应在预算内返回，实际 ${Date.now() - t0}ms`);
  });

  it('浏览器内置页 / 应用商店 / 本地文件页：单独文案，不重试等注入', async () => {
    for (const url of ['chrome://newtab/', 'https://chromewebstore.google.com/detail/x', 'file:///tmp/a.html']) {
      const sandbox = stackWithTab(deadChannelTab(url, 'complete'));
      let sent = 0;
      const inner = sandbox.chrome.tabs.sendMessage;
      sandbox.chrome.tabs.sendMessage = async (id, msg) => { sent += 1; return inner(id, msg); };

      const resp = await sandbox.askContentPageAdvisorContext(1);

      assert.equal(resp.errorCode, 'PAGE_CONTEXT_RESTRICTED_PAGE', `url=${url}`);
      assert.equal(resp.error, sandbox.tx('paContextRestrictedPage'), `url=${url}`);
      assert.ok(sent <= 2, `受限页面不该进重试循环，实际 ${sent} 次`);
    }
  });

  it('content script 在线但自报未就绪：保留它自己的文案（不被兜底文案盖掉）', async () => {
    const tab = {
      id: 1,
      url: 'https://shop.test/p',
      status: 'complete',
      sendMessage: async (_tabId, msg) => (msg.action === 'getPageAdvisorContext'
        ? { success: false, error: '页面助手尚未就绪' }
        : undefined),
    };
    const sandbox = stackWithTab(tab);

    const resp = await sandbox.askContentPageAdvisorContext(1);

    assert.equal(resp.success, false);
    assert.equal(resp.error, '页面助手尚未就绪');
  });
});

describe('generatePageAdvisorSuggestions 采集失败出口', () => {
  it('联系不上页面：错误码与文案透传，且不发任何请求', async () => {
    const sandbox = stackWithTab(deadChannelTab('https://shop.test/p', 'complete'));
    let http = 0;
    sandbox.APIHttp.request = async () => { http += 1; throw new Error('不该发请求'); };

    const result = await sandbox.generatePageAdvisorSuggestions(1, {});

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'PAGE_CONTEXT_UNREACHABLE');
    assert.match(result.error, /刷新/);
    assert.equal(result.traceId, '');
    assert.equal(http, 0, '本地就挡住了，不该发起请求');
  });

  it('页面类型不支持：错误码透传为 PAGE_CONTEXT_RESTRICTED_PAGE', async () => {
    const sandbox = stackWithTab(deadChannelTab('chrome://newtab/', 'complete'));

    const result = await sandbox.generatePageAdvisorSuggestions(1, {});

    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'PAGE_CONTEXT_RESTRICTED_PAGE');
    assert.equal(result.error, sandbox.tx('paContextRestrictedPage'));
  });
});
