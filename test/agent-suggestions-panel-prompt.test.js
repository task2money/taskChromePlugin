'use strict';

/**
 * 侧边栏「智能体建议」：提示词下拉的数据源改为服务端目录（Task 12）。
 *
 * 下拉不再读本机 prompt skills：侧栏向后台发 `loadPageAdvisorPromptOptions`，
 * 用返回的 `{ok, skills, defaultSkillId, defaultTitle}` 渲染「默认项 + 服务端条目」；
 * 选中值存 `pageAdvisorSelectedPromptId`（PageAdvisorPromptOptions 的 SSOT），
 * 生成消息带 `promptSkillId`/`promptTendency`。
 *
 * 本用例在 vm 里加载真实的 `sidepanel/agent-suggestions-panel.js` 与
 * `lib/page-advisor-prompt-options.js`，用假 DOM / 假 chrome 驱动；其余生成、
 * 试用、刷新重试的回归用例保持惯例（假 DOM + 假 chrome）。
 *
 * 另外钉住：加载失败不挡列表、重试重新请求；工作空间变化清缓存并重拉、卸载时移除监听。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const MESSAGES = {
  agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
  agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
  agentSuggestionsTrialHint: '未登录：点「给当前网页生成建议」会消耗每日试用次数；登录后可把建议保存为优化贴。',
  agentSuggestionsTrialNotice: '试用建议（未保存）：登录后可用自己的智能体继续生成并保存为优化贴。',
  agentSuggestionsAnonymousPosted: '已生成匿名优化贴（暂存在系统项目，登录后可领取到自己的项目）',
  agentSuggestionsLoadFail: '智能体建议加载失败',
  agentSuggestionsCountAria: '{n} 条待处理',
  agentSuggestionsPostCount: '{n} 条建议',
  agentSuggestionsPromptLabel: '提示词',
  agentSuggestionsPromptDefault: '默认提示词',
  agentSuggestionsGenerate: '给当前网页生成建议',
  agentSuggestionsGenerating: '正在为当前网页生成建议…',
  agentSuggestionsProgressAria: '生成建议进度',
  agentSuggestionsProgressCapture: '正在采集当前网页…',
  agentSuggestionsProgressSubmit: '正在提交生成任务…',
  agentSuggestionsProgressQueued: '任务排队中…',
  agentSuggestionsProgressGenerating: '模型正在生成建议…',
  agentSuggestionsProgressPosting: '正在保存优化贴…',
  agentSuggestionsProgressDone: '生成完成',
  agentSuggestionsProgressFailed: '生成失败',
  agentSuggestionsProgressElapsed: '已用 {time}',
  agentSuggestionsProgressEta: '约剩 {time}',
  agentSuggestionsProgressAlmost: '即将完成',
  agentSuggestionsGeneratedInto: '已在「{project}」创建优化贴',
  agentSuggestionsPostedExisting: '「{project}」里已有当前网页的优化贴',
  agentSuggestionsGenerateFail: '生成建议失败',
  agentSuggestionsReloadRetry: '刷新当前网页并重试',
  agentSuggestionsReloading: '正在刷新当前网页…',
  // 2026-11-07 诊断块与细分失败文案
  agentSuggestionsGeneratingHint: '通常 20–60 秒，最长约 2 分钟',
  agentSuggestionsDiagElapsedUnknown: '未知',
  agentSuggestionsDiagMeta: '错误码 {code} · 耗时 {elapsed} · traceId {traceId}',
  agentSuggestionsDiagMetaNoTrace: '错误码 {code} · 耗时 {elapsed}',
  agentSuggestionsDiagCopied: '诊断信息已复制',
  agentSuggestionsDiagCopyFail: '复制失败，请手动选择诊断信息',
  agentSuggestionsTrialPostFailed: '建议已生成，但优化贴未能创建（{reason}）。可复制诊断信息反馈。',
  agentSuggestionsPostUnavailable: '优化贴服务暂时不可用',
  agentSuggestionsPostClosed: '试用帖子入口已关闭',
  paContextUnreachable: '页面联系不上插件脚本，刷新当前网页即可恢复',
  paTrialRemaining: '未登录试用：今日还可试用 {n} 次（每天 {total} 次，{resetsAt} 重置）',
  paTrialQuotaExhausted: '未登录试用：今日次数已用完，{resetsAt} 重置；登录后可用自己的智能体额度。',
  paTrialPaused: '未登录试用：网页优化试用已暂停，登录后可用自己的智能体。',
  paPromptDefaultOption: '默认 · {title}',
  paPromptAuditBadge: '审计',
  paPromptWorkspaceBadge: '工作空间',
  paPromptLoadFailed: '提示词加载失败，请重试',
  paPromptRetry: '重试',
};

/** 服务端目录的形状（后台 loadPageAdvisorPromptOptions 的投影）。 */
const SERVER_SKILLS = [
  {
    id: 'sys-seo', title: 'SEO 标题优化', tendency: 'seo', runtime: 'rewrite', source: 'catalog', readonly: true,
  },
  {
    id: 'ws-conv', title: '转化专项', tendency: 'conversion', runtime: 'rewrite', source: 'workspace', readonly: false,
  },
];

function promptOptionsResponse(overrides = {}) {
  return Object.assign({
    ok: true,
    skills: SERVER_SKILLS.map((skill) => Object.assign({}, skill)),
    defaultSkillId: 'sys-seo',
    defaultTitle: 'SEO 标题优化',
    partialError: false,
  }, overrides);
}

function makeEl(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    hidden: false,
    value: '',
    checked: false,
    disabled: false,
    dataset: {},
    attrs: {},
    listeners: {},
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
    setAttribute(key, value) { this.attrs[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this.attrs[key] : null; },
    removeAttribute(key) { delete this.attrs[key]; },
    querySelectorAll() { return []; },
    dispatch(type, ev) {
      (this.listeners[type] || []).forEach((fn) => fn(ev || {}));
    },
  };
}

function optionValues(html) {
  return [...String(html || '').matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

function buildHarness({
  generateResponse,
  promptOptions,
  initialSelectedId = '',
  probeResponse = { success: true, retryable: false },
  reloadResponse = { success: true },
  progressResponse = { success: true, progress: null },
  quotaResponse = {
    success: true,
    quota: { enabled: true, remaining: 3, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
  },
  etaSamples = [],
  etaDiagnostics = [],
} = {}) {
  const els = {};
  const document = {
    getElementById(id) {
      if (!els[id]) els[id] = makeEl(id);
      return els[id];
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };

  const sent = [];
  let listResponse = { success: true, items: [] };
  // 服务端提示词选项：可传对象，也可传 `(callNo) => object` 做「先失败后成功」。
  let promptResponse = promptOptions || promptOptionsResponse();
  let promptCalls = 0;
  // 与 lib/storage.js 同形的持久化面：PageAdvisorPromptOptions 经它读写选中值。
  const store = {};
  if (initialSelectedId) store.pageAdvisorSelectedPromptId = initialSelectedId;
  const storageListeners = [];
  const windowListeners = {};
  const runtimeMessageListeners = [];

  const Storage = {
    async get(keys) {
      const out = {};
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = store[key];
      }
      return out;
    },
    async set(patch) { Object.assign(store, patch); },
  };

  const context = {
    console,
    document,
    URL,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Storage,
    tx: (key, params) => {
      let out = MESSAGES[key] || key;
      if (params && typeof params === 'object') {
        Object.keys(params).forEach((k) => { out = out.replace(`{${k}}`, String(params[k])); });
      }
      return out;
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(fn) {
            if (!runtimeMessageListeners.includes(fn)) runtimeMessageListeners.push(fn);
            context.__onMessage = fn;
          },
          removeListener(fn) {
            const at = runtimeMessageListeners.indexOf(fn);
            if (at >= 0) runtimeMessageListeners.splice(at, 1);
          },
        },
        getManifest: () => ({ content_scripts: [{ js: [] }] }),
        sendMessage(message) {
          sent.push(message);
          const action = message && message.action;
          if (action === 'listSitePendingForActiveTab' || action === 'refreshSitePendingForActiveTab') {
            return Promise.resolve(listResponse);
          }
          if (action === 'generateAgentSuggestionsForActiveTab') {
            return Promise.resolve(generateResponse || { success: true, created: true, projectName: '默认项目' });
          }
          if (action === 'loadPageAdvisorPromptOptions') {
            promptCalls += 1;
            const next = typeof promptResponse === 'function' ? promptResponse(promptCalls) : promptResponse;
            return Promise.resolve(next);
          }
          if (action === 'probeAgentSuggestionsChannel') return Promise.resolve(probeResponse);
          if (action === 'reloadPageAndRetryAgentSuggestions') return Promise.resolve(reloadResponse);
          // 可传对象，也可传 `() => Promise` 模拟「额度回包晚于生成成功状态」的时序。
          if (action === 'getPageTrialQuota') {
            return typeof quotaResponse === 'function' ? quotaResponse() : Promise.resolve(quotaResponse);
          }
          if (action === 'getAgentSuggestionsProgress') return Promise.resolve(progressResponse);
          if (action === 'clearAgentSuggestionsProgress') return Promise.resolve({ success: true });
          return Promise.resolve({ success: true });
        },
      },
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
        onChanged: {
          addListener(fn) { if (!storageListeners.includes(fn)) storageListeners.push(fn); },
          removeListener(fn) {
            const at = storageListeners.indexOf(fn);
            if (at >= 0) storageListeners.splice(at, 1);
          },
        },
      },
      tabs: { query: async () => [{ id: 7 }], onActivated: { addListener() {} } },
    },
    window: {
      addEventListener(type, fn) {
        if (!windowListeners[type]) windowListeners[type] = [];
        windowListeners[type].push(fn);
      },
    },
  };
  context.globalThis = context;
  vm.createContext(context);

  // 真模块：选中值的读写与 resetCache 行为都由它落地，测试只替身存储与调用计数。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'page-advisor-prompt-options.js'), 'utf8'),
    context,
  );
  // 进度模型与侧栏同源：阶段起点/上限、心跳都走真实实现。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'agent-suggestions-progress.js'), 'utf8'),
    context,
  );
  // 估时自学习：样本也走真实实现，存储面用上面的 Storage 替身。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'agent-suggestions-eta.js'), 'utf8'),
    context,
  );
  if (Array.isArray(etaSamples) && etaSamples.length) {
    store[context.AgentSuggestionsEta.STORAGE_KEY] = etaSamples.slice(-context.AgentSuggestionsEta.MAX_SAMPLES);
  }
  if (Array.isArray(etaDiagnostics) && etaDiagnostics.length) {
    store[context.AgentSuggestionsEta.DIAGNOSTICS_KEY] = etaDiagnostics.slice();
  }
  // 列表渲染与选中逻辑走真实实现：恢复进度后要能选中刷新出来的新帖。
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'lib', 'page-advisor-site-pending.js'), 'utf8'),
    context,
  );
  const resetCalls = { count: 0 };
  const realReset = context.PageAdvisorPromptOptions.resetCache;
  context.PageAdvisorPromptOptions.resetCache = () => {
    resetCalls.count += 1;
    realReset();
  };

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'sidepanel', 'agent-suggestions-panel.js'), 'utf8'), context);

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    context,
    els,
    sent,
    store,
    resetCalls,
    promptOptionsCalls() { return promptCalls; },
    setListResponse(next) { listResponse = next; },
    setPromptOptions(next) { promptResponse = next; },
    promptSelect() { return document.getElementById('sp-agent-prompt'); },
    generateBtn() { return document.getElementById('sp-agent-generate'); },
    status() { return document.getElementById('sp-agent-status').textContent; },
    promptStatus() { return document.getElementById('sp-agent-prompt-status').textContent; },
    promptRetryBtn() { return document.getElementById('sp-agent-prompt-retry'); },
    actions() { return sent.map((m) => m && m.action); },
    reloadRetryBtn() { return document.getElementById('sp-agent-reload-retry'); },
    tick,
    /** 面板刷新 + 等下拉的服务端请求落地（下拉加载不挡列表，需让出一次宏任务）。 */
    async refresh() {
      await context.AgentSuggestionsPanel.refresh();
      await tick();
    },
    emitStorageChanged(changes, area = 'local') {
      storageListeners.slice().forEach((fn) => fn(changes, area));
    },
    storageListenerCount() { return storageListeners.length; },
    fireUnload() {
      (windowListeners.unload || []).slice().forEach((fn) => fn());
    },
    emitRuntimeMessage(message) {
      runtimeMessageListeners.slice().forEach((fn) => fn(message));
    },
    runtimeMessageListenerCount() { return runtimeMessageListeners.length; },
    progressBox() { return document.getElementById('sp-agent-progress'); },
    progressBar() { return document.getElementById('sp-agent-progress-bar'); },
    progressStage() { return document.getElementById('sp-agent-progress-stage').textContent; },
    progressElapsed() { return document.getElementById('sp-agent-progress-elapsed').textContent; },
    progressPct() { return document.getElementById('sp-agent-progress-pct').textContent; },
    async clickGenerate() {
      const btn = document.getElementById('sp-agent-generate');
      await btn.listeners.click[0]();
    },
    async clickReloadRetry() {
      const btn = document.getElementById('sp-agent-reload-retry');
      await btn.listeners.click[0]();
    },
    async clickPromptRetry() {
      const btn = document.getElementById('sp-agent-prompt-retry');
      await btn.listeners.click[0]();
      await tick();
    },
  };
}

describe('侧栏提示词下拉改为服务端目录', () => {
  it('渲染默认项 + 服务端技能（按顺序、跳过默认 id 重复项、标注审计与工作空间）', async () => {
    const h = buildHarness({
      promptOptions: promptOptionsResponse({
        skills: [
          SERVER_SKILLS[0],
          {
            id: 'sys-a11y', title: '无障碍 <巡检>', tendency: 'a11y', runtime: 'audit', source: 'catalog', readonly: true,
          },
          SERVER_SKILLS[1],
          // 与默认 id 相同的重复项：默认项已经代表它，不得再出现第二条
          {
            id: 'sys-seo', title: 'SEO 副本', tendency: 'seo', runtime: 'rewrite', source: 'workspace', readonly: false,
          },
        ],
      }),
    });
    await h.refresh();

    const html = h.promptSelect().innerHTML;
    assert.match(html, /^<option value="">默认 · SEO 标题优化<\/option>/, '首项是默认提示词');
    assert.deepEqual(optionValues(html), ['', 'sys-a11y', 'ws-conv'], '按服务端顺序渲染，默认 id 只由首项代表');
    assert.ok(html.indexOf('value="sys-a11y"') < html.indexOf('value="ws-conv"'), '保持服务端顺序');
    assert.match(html, /value="sys-a11y"[^>]*>[^<]*审计/, 'audit 运行时带「审计」标记');
    assert.match(html, /value="ws-conv"[^>]*>[^<]*工作空间/, 'readonly:false 的工作空间自定义带「工作空间」标记');
    assert.match(html, /&lt;巡检>/, '标题必须转义');
    assert.doesNotMatch(html, /<巡检>/, '标题不得原样拼进 innerHTML');
    assert.equal(h.promptSelect().value, '', '记忆为空时停在默认项');
  });

  it('选中值取持久化记忆；不在列表里就回落默认并清掉记忆', async () => {
    const kept = buildHarness({ initialSelectedId: 'ws-conv' });
    await kept.refresh();
    assert.equal(kept.promptSelect().value, 'ws-conv', '列表里有的记忆值原样选中');

    const stale = buildHarness({ initialSelectedId: 'gone-skill' });
    await stale.refresh();
    assert.equal(stale.promptSelect().value, '', '列表里没有的记忆值回落默认');
    assert.equal(stale.store.pageAdvisorSelectedPromptId, '', '失效的记忆值必须从 storage 清掉');

    // 默认 id 没有独立 option：记忆里存着它时等价于「默认项」，不能落到不存在的选中值。
    const defaultValue = buildHarness({ initialSelectedId: 'sys-seo' });
    await defaultValue.refresh();
    assert.equal(defaultValue.promptSelect().value, '', '默认 id 映射到默认项');
    assert.equal(defaultValue.store.pageAdvisorSelectedPromptId, '', '默认 id 归一成空串');
  });

  it('change 时持久化选中值', async () => {
    const h = buildHarness();
    await h.refresh();
    const sel = h.promptSelect();
    sel.value = 'ws-conv';
    sel.dispatch('change');
    await h.tick();
    assert.equal(h.store.pageAdvisorSelectedPromptId, 'ws-conv');

    sel.value = '';
    sel.dispatch('change');
    await h.tick();
    assert.equal(h.store.pageAdvisorSelectedPromptId, '', '改回默认项也要落盘');
  });

  it('加载失败：状态行报错 + 露出重试，但不挡住列表加载', async () => {
    let attempts = 0;
    const h = buildHarness({
      promptOptions: () => {
        attempts += 1;
        return attempts === 1
          ? { ok: false, error: '目录不可用', errorCode: 'PAGE_ADVISOR_PROMPT_OPTIONS_FAILED' }
          : promptOptionsResponse();
      },
    });
    await h.refresh();

    assert.equal(h.promptStatus(), '提示词加载失败，请重试');
    assert.equal(h.promptRetryBtn().hidden, false, '失败时露出重试入口');
    assert.deepEqual(optionValues(h.promptSelect().innerHTML), [''], '失败时下拉只保留默认项');
    assert.ok(h.actions().includes('listSitePendingForActiveTab'), '提示词加载失败不影响建议列表请求');
    assert.equal(h.status(), '当前网页没有待处理的智能体建议', '列表照常给出空态');

    await h.clickPromptRetry();
    assert.equal(h.promptOptionsCalls(), 2, '重试重新请求服务端选项');
    assert.equal(h.promptStatus(), '', '成功后清掉失败状态');
    assert.equal(h.promptRetryBtn().hidden, true, '成功后收起重试入口');
    assert.deepEqual(optionValues(h.promptSelect().innerHTML), ['', 'ws-conv'], '重试成功后恢复服务端条目');
  });

  it('响应形状不对（{} / {skills:null}）按失败处理：状态行 + 重试，不是空目录', async () => {
    for (const bad of [{}, { skills: null }]) {
      const h = buildHarness({ promptOptions: bad });
      await h.refresh();

      assert.equal(h.promptStatus(), '提示词加载失败，请重试', `畸形响应 ${JSON.stringify(bad)} 要报错`);
      assert.equal(h.promptRetryBtn().hidden, false, '畸形响应露出重试入口');
      assert.deepEqual(optionValues(h.promptSelect().innerHTML), [''], '畸形响应下拉只保留默认项');
    }
  });

  it('生成消息带 promptSkillId/promptTendency；默认项与列表外 id 一律为空', async () => {
    const h = buildHarness();
    await h.refresh();
    const sel = h.promptSelect();

    sel.value = 'ws-conv';
    await h.clickGenerate();
    let gen = h.sent.filter((m) => m && m.action === 'generateAgentSuggestionsForActiveTab').pop();
    assert.ok(gen, 'generation message sent');
    assert.equal(gen.promptSkillId, 'ws-conv');
    assert.equal(gen.promptTendency, 'conversion');
    assert.equal(gen.skillId, undefined, '本机 skillId 字段已退役');
    assert.equal(gen.pageUrl, undefined, '生成只管当前网页，不再传网址');

    h.sent.length = 0;
    sel.value = '';
    await h.clickGenerate();
    gen = h.sent.filter((m) => m && m.action === 'generateAgentSuggestionsForActiveTab').pop();
    assert.equal(gen.promptSkillId, '', '默认项不指定提示词');
    assert.equal(gen.promptTendency, '');

    h.sent.length = 0;
    sel.value = 'not-in-current-list';
    await h.clickGenerate();
    gen = h.sent.filter((m) => m && m.action === 'generateAgentSuggestionsForActiveTab').pop();
    assert.equal(gen.promptSkillId, '', '不在当前列表里的 id 不许回传');
    assert.equal(gen.promptTendency, '');
  });

  it('工作空间变化：清缓存并重拉；卸载时移除监听', async () => {
    const h = buildHarness({ initialSelectedId: 'ws-conv' });
    await h.refresh();
    assert.equal(h.promptOptionsCalls(), 1);
    assert.equal(h.storageListenerCount(), 1, '面板应监听 storage 变化');

    h.emitStorageChanged({ otherKey: { newValue: 1 } }, 'local');
    await h.tick();
    assert.equal(h.promptOptionsCalls(), 1, '无关的 storage 变化不重拉');

    h.setPromptOptions(promptOptionsResponse({ skills: [SERVER_SKILLS[0]] }));
    h.emitStorageChanged({ lastWorkspaceId: { oldValue: 'ws-1', newValue: 'ws-2' } }, 'local');
    await h.tick();

    assert.equal(h.resetCalls.count, 1, '切工作空间先清合并列表缓存');
    assert.equal(h.promptOptionsCalls(), 2, '再重新拉服务端选项');
    assert.equal(h.promptSelect().value, '', '新列表没有旧选中 → 回落默认');
    assert.equal(h.store.pageAdvisorSelectedPromptId, '', '跨工作空间失效的选中值清掉');

    h.fireUnload();
    assert.equal(h.storageListenerCount(), 0, 'unload 时移除监听');
    h.emitStorageChanged({ lastWorkspaceId: { oldValue: 'ws-2', newValue: 'ws-3' } }, 'local');
    await h.tick();
    assert.equal(h.promptOptionsCalls(), 2, '卸载后不再响应工作空间变化');
  });
});

describe('侧栏生成按钮与试用回归', () => {
  it('生成中按钮锁住并写明状态，生成完报出落点项目', async () => {
    const h = buildHarness({
      generateResponse: { success: true, created: true, projectName: '默认项目', postId: '1001' },
    });
    await h.refresh();
    h.setListResponse({ success: true, items: [{ id: '1001', tenant_id: '1', title: '建议一' }] });

    const btn = h.generateBtn();
    const pending = h.clickGenerate();
    assert.equal(btn.disabled, true, '生成期间按钮不可重复点');
    assert.equal(btn.getAttribute('aria-busy'), 'true');
    assert.match(h.status(), /正在为当前网页生成建议/);
    await pending;

    assert.equal(btn.disabled, false);
    assert.equal(h.status(), '已在「默认项目」创建优化贴');
    assert.ok(h.actions().includes('listSitePendingForActiveTab'), '生成后重拉列表');
  });

  it('生成期间显示进度条：阶段文案与百分比随后台事件推进，成功后自动收起', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = buildHarness({ generateResponse: gate });
    await h.refresh();

    const pending = h.clickGenerate();
    assert.equal(h.progressBox().hidden, false, '点生成后立即显示进度条');
    assert.equal(h.progressStage(), '正在采集当前网页…');
    assert.equal(h.progressPct(), '8%');
    assert.equal(h.progressElapsed(), '已用 00:00 · 约剩 01:00', '点击即给出已耗时与预计剩余（按 60s 基准）');
    const gen = h.sent.filter((m) => m && m.action === 'generateAgentSuggestionsForActiveTab').pop();
    assert.ok(gen.progressRunId, '生成消息带本次 runId');

    h.emitRuntimeMessage({
      action: 'agentSuggestionsProgress',
      runId: gen.progressRunId,
      progress: { stage: 'generating', percent: 62 },
    });
    assert.equal(h.progressStage(), '模型正在生成建议…');
    assert.equal(h.progressPct(), '62%');
    assert.equal(h.progressBar().value, 62);

    // 迟到的旧 runId 事件不能画到本次进度条上
    h.emitRuntimeMessage({
      action: 'agentSuggestionsProgress',
      runId: 'stale-run',
      progress: { stage: 'done', percent: 100 },
    });
    assert.equal(h.progressPct(), '62%');

    release({ success: true, created: true, projectName: '默认项目' });
    await pending;
    assert.equal(h.progressStage(), '生成完成');
    assert.equal(h.progressPct(), '100%');
    // 完成后先亮一下满格，再自动收起（默认停留 900ms）。
    await new Promise((resolve) => setTimeout(resolve, 950));
    assert.equal(h.progressBox().hidden, true, '完成后收起进度条');
    assert.equal(h.status(), '已在「默认项目」创建优化贴');
  });

  it('已耗时随时间推进；预计剩余为估算值，超时改「即将完成」', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = buildHarness({ generateResponse: gate });
    await h.refresh();

    const pending = h.clickGenerate();
    await new Promise((resolve) => setTimeout(resolve, 1150));
    assert.match(h.progressElapsed(), /^已用 00:01 · 约剩 00:(58|59)$/, '已耗时每秒推进，剩余时间同步递减');

    release({ success: true, created: true, projectName: '默认项目' });
    await pending;
    assert.doesNotMatch(h.progressElapsed(), /约剩|即将完成/, '终态不再显示倒计时');
  });

  it('预计剩余按最近成功生成的实际耗时估算，不再写死 60 秒', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = buildHarness({
      generateResponse: gate,
      // 近期三次都约 22s：估值应落在 22s，而不是默认 60s。
      etaSamples: [20000, 22000, 24000],
    });
    await h.refresh();

    const pending = h.clickGenerate();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.match(
        h.progressElapsed(),
        /^已用 00:0[01] · 约剩 00:(21|22)$/,
        '总时长取历史中位数 22s，剩余 = 22s - 已耗时',
      );
    } finally {
      // 断言失败也要释放生成，避免进度心跳把测试进程挂住。
      release({ success: true, created: true, projectName: '默认项目' });
      await pending;
    }
    assert.doesNotMatch(h.progressElapsed(), /约剩|即将完成/, '终态不再显示倒计时');
  });

  it('升级后还没有新样本时，用诊断记录里的成功耗时兜底', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const h = buildHarness({
      generateResponse: gate,
      etaDiagnostics: [
        { result: 'success', elapsedMs: 20000 },
        { result: 'failed', elapsedMs: 300 },
        { result: 'no_post', elapsedMs: 24000 },
      ],
    });
    await h.refresh();

    const pending = h.clickGenerate();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.match(
        h.progressElapsed(),
        /^已用 00:0[01] · 约剩 00:(21|22)$/,
        '中位数 22s 来自诊断历史，第一次点击就生效',
      );
    } finally {
      release({ success: true, created: true, projectName: '默认项目' });
      await pending;
    }
  });

  it('已耗时超过历史估值时显示「即将完成」，不倒计时成负数', async () => {
    const h = buildHarness({
      // 历史都不到 10s，本次已跑 12s：剩余归零。
      etaSamples: [8000, 9000, 10000],
      progressResponse: {
        success: true,
        progress: {
          tabId: 7,
          runId: 'run-slow',
          stage: 'generating',
          percent: 62,
          startedAt: Date.now() - 12000,
        },
      },
    });
    await h.refresh();
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.match(h.progressElapsed(), /^已用 00:1[23] · 即将完成$/);
    } finally {
      // 续显会起进度心跳；断言失败也要停掉，避免挂住测试进程。
      h.fireUnload();
    }
  });

  it('关闭侧栏再打开：恢复后台进度，完成广播后刷新列表、选中新帖并收起', async () => {
    const h = buildHarness({
      progressResponse: {
        success: true,
        progress: {
          tabId: 7,
          runId: 'run-restored',
          stage: 'generating',
          percent: 62,
          startedAt: Date.now() - 65000,
        },
      },
    });
    h.setListResponse({ success: true, items: [{ id: '1001', tenant_id: '1', title: '建议一' }] });
    await h.refresh();

    assert.equal(h.progressBox().hidden, false, '重开后继续显示未完成的进度');
    assert.equal(h.progressStage(), '模型正在生成建议…');
    assert.equal(h.progressPct(), '62%');
    assert.equal(h.progressElapsed(), '已用 01:05 · 即将完成', '沿用后台记下的开始时间，超时不倒计时成负数');
    assert.equal(h.generateBtn().disabled, true, '续显期间锁住生成按钮，避免重复发起');

    const listCalls = h.actions().filter((a) => a === 'listSitePendingForActiveTab').length;
    h.emitRuntimeMessage({
      action: 'agentSuggestionsProgress',
      runId: 'run-restored',
      progress: { stage: 'done', percent: 100 },
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    assert.equal(h.progressBox().hidden, true, '完成后收起进度');
    assert.equal(h.status(), '生成完成');
    assert.ok(
      h.actions().filter((a) => a === 'listSitePendingForActiveTab').length > listCalls,
      '侧栏关着时生成完的新帖要重新拉出来',
    );
    assert.ok(h.actions().includes('selectAgentSuggestionPost'), '刷新后把选中的帖子显示到页面');
    assert.ok(h.actions().includes('clearAgentSuggestionsProgress'), '收起时清掉会话快照');
    assert.equal(h.generateBtn().disabled, false, '收尾后恢复生成按钮');
  });

  it('关闭侧栏再打开：收到失败终态时如实报错，失败态停留后收起', async () => {
    const h = buildHarness({
      progressResponse: {
        success: true,
        progress: {
          tabId: 7,
          runId: 'run-failed',
          stage: 'generating',
          percent: 55,
          startedAt: Date.now() - 10000,
        },
      },
    });
    await h.refresh();

    h.emitRuntimeMessage({
      action: 'agentSuggestionsProgress',
      runId: 'run-failed',
      progress: { stage: 'failed', percent: 100 },
    });
    assert.equal(h.progressBox().hidden, false, '失败态先停住，不再一失败就消失');
    assert.equal(h.status(), '生成建议失败');
    assert.equal(h.els['sp-agent-diag'].hidden, false, '重开侧栏也要有诊断入口');

    await new Promise((resolve) => setTimeout(resolve, 6300));
    assert.equal(h.progressBox().hidden, true);
  });

  it('生成失败：失败态停留约 6 秒，错误码/traceId 同时进状态行与诊断块', async () => {
    const h = buildHarness({
      generateResponse: {
        success: false,
        error: '未登录',
        errorCode: 'PAGE_CONTEXT_UNREACHABLE',
        traceId: 't-2',
      },
    });
    await h.refresh();
    await h.clickGenerate();

    assert.equal(h.progressBox().hidden, false, '失败后进度条以失败态停留');
    assert.equal(h.progressStage(), '生成失败');
    assert.equal(h.status(), '未登录');
    assert.equal(h.els['sp-agent-status'].attrs['data-traceId'], 't-2');
    assert.equal(h.els['sp-agent-status'].attrs['data-error-code'], 'PAGE_CONTEXT_UNREACHABLE');
    assert.equal(h.els['sp-agent-diag'].hidden, false);
    assert.match(h.els['sp-agent-diag-meta'].textContent, /PAGE_CONTEXT_UNREACHABLE/);
    assert.equal(h.els['sp-agent-diag-meta'].attrs['data-traceId'], 't-2');

    await new Promise((resolve) => setTimeout(resolve, 6300));
    assert.equal(h.progressBox().hidden, true);
    assert.ok(h.actions().includes('clearAgentSuggestionsProgress'), '失败收起时清掉会话快照');
  });

  it('卸载时移除进度消息监听', async () => {
    const h = buildHarness();
    await h.refresh();
    assert.equal(h.runtimeMessageListenerCount(), 1);
    h.fireUnload();
    assert.equal(h.runtimeMessageListenerCount(), 0, '侧栏卸载后不再接收进度广播');
  });

  it('已存在的优化贴不谎报新建', async () => {
    const h = buildHarness({
      generateResponse: { success: true, created: false, projectName: '官网', postId: '1001' },
    });
    await h.refresh();
    await h.clickGenerate();
    assert.equal(h.status(), '「官网」里已有当前网页的优化贴');
  });

  it('生成失败把后台的错因写到状态行，按钮恢复可点', async () => {
    const h = buildHarness({
      generateResponse: { success: false, error: '未登录', traceId: 't-1' },
    });
    await h.refresh();
    await h.clickGenerate();

    assert.equal(h.status(), '未登录');
    assert.equal(h.generateBtn().disabled, false);
  });

  it('匿名试用结果渲染在侧栏，状态行报剩余次数，且不重拉建议贴列表', async () => {
    const h = buildHarness({
      generateResponse: {
        success: true,
        trial: true,
        trialId: 'pt-1',
        count: 2,
        suggestions: [
          { title: '改标题', summary: '首屏标题更具体', detail: '换成含卖点的标题' },
          { title: '加对比', summary: '补一张对比表' },
        ],
        quota: { enabled: true, remaining: 2, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
      },
    });
    await h.refresh();
    const listCalls = h.actions().filter((a) => a === 'listSitePendingForActiveTab').length;

    await h.clickGenerate();

    const body = h.els['sp-agent-body'].innerHTML;
    assert.match(body, /data-testid="sp-agent-trial"/);
    assert.match(body, /试用建议（未保存）/);
    assert.match(body, /改标题/);
    assert.match(body, /加对比/);
    assert.match(h.status(), /还可试用 2 次/);
    assert.match(h.status(), /每天 3 次/);
    assert.equal(
      h.actions().filter((a) => a === 'listSitePendingForActiveTab').length,
      listCalls,
      '试用结果不替换建议贴列表',
    );
    assert.equal(h.generateBtn().disabled, false);
  });

  it('试用落贴失败：建议照常渲染，状态行说明原因并露出诊断块', async () => {
    const h = buildHarness({
      generateResponse: {
        success: true,
        trial: true,
        trialId: 'pt-2',
        traceId: 'trace-post',
        postError: 'unavailable',
        suggestions: [{ title: '改标题', summary: '首屏标题更具体' }],
        quota: { enabled: true, remaining: 2, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
      },
    });
    await h.refresh();
    await h.clickGenerate();

    assert.match(h.els['sp-agent-body'].innerHTML, /改标题/);
    assert.match(h.status(), /优化贴服务暂时不可用/);
    assert.equal(h.els['sp-agent-status'].attrs['data-error-code'], 'post_unavailable');
    assert.equal(h.els['sp-agent-status'].attrs['data-traceId'], 'trace-post');
    assert.equal(h.els['sp-agent-diag'].hidden, false);
    assert.match(h.els['sp-agent-diag-meta'].textContent, /post_unavailable/);
    assert.equal(h.els['sp-agent-diag-meta'].attrs['data-traceId'], 'trace-post');
  });

  it('匿名落贴成功：刷新没带回这条帖也要显示，晚到的额度回包不得盖掉成功状态', async () => {
    const h = buildHarness({
      generateResponse: {
        success: true,
        trial: true,
        trialId: 'pt-3',
        postId: 'anon-77',
        traceId: 'trace-anon',
        suggestions: [
          { title: '改标题', summary: '首屏标题更具体', detail: '换成含卖点的标题' },
        ],
        quota: { enabled: true, remaining: 0, daily_quota: 3, resets_at: '2026-11-07T16:00:00Z' },
      },
      // 额度查询故意晚回：成功状态已经落地后它才到，旧实现会盖成「次数已用完」。
      quotaResponse: () => new Promise((resolve) => setTimeout(() => resolve({
        success: true,
        quota: { enabled: true, remaining: 0, daily_quota: 3, resets_at: '2026-11-07T16:00:00Z' },
      }), 10)),
    });
    h.setListResponse({ success: true, items: [], reason: 'not_logged_in' });
    await h.refresh();
    await h.clickGenerate();
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(h.status(), '已生成匿名优化贴（暂存在系统项目，登录后可领取到自己的项目）');
    assert.doesNotMatch(h.status(), /今日次数已用完/, '额度提示不得抢走落贴成功的状态行');
    assert.match(h.els['sp-agent-posts'].innerHTML, /data-post-id="anon-77"/, '兜底条目让刚生成的匿名贴可见');
    assert.equal(h.els['sp-agent-status'].attrs['data-traceId'], 'trace-anon');
  });

  it('匿名落贴成功且列表已带回这条帖：只渲染一条，不重复补条目', async () => {
    const h = buildHarness({
      generateResponse: {
        success: true,
        trial: true,
        trialId: 'pt-4',
        postId: 'anon-88',
        suggestions: [{ title: '改标题', summary: '首屏标题更具体' }],
        quota: { enabled: true, remaining: 1, daily_quota: 3, resets_at: '2026-11-07T16:00:00Z' },
      },
    });
    h.setListResponse({
      success: true,
      items: [{
        id: 'anon-88', post_id: 'anon-88', title: '改标题', owner_kind: 'anonymous', anonymous: true, confirm_status: 'pending',
      }],
      reason: 'not_logged_in',
      pageUrl: 'https://shop.test/p',
    });
    await h.refresh();
    await h.clickGenerate();
    await new Promise((r) => setTimeout(r, 0));

    const html = h.els['sp-agent-posts'].innerHTML;
    assert.equal(
      (html.match(/taskplugin-page-advisor-post-tab-anon-88/g) || []).length,
      1,
      '列表已有的帖子不再补一条',
    );
    assert.equal(h.status(), '已生成匿名优化贴（暂存在系统项目，登录后可领取到自己的项目）');
  });

  it('未登录打开面板：提示可试用，并异步补上今日剩余额度', async () => {
    const h = buildHarness();
    h.setListResponse({ success: true, items: [], reason: 'not_logged_in' });
    // 这里要卡在「列表刚回来、额度提示还没落地」的时刻，故不用会多让出一个宏任务的 refresh()。
    await h.context.AgentSuggestionsPanel.refresh();
    assert.match(h.status(), /每日试用次数/);
    await new Promise((r) => setTimeout(r, 0));
    assert.match(h.status(), /还可试用 3 次/);
  });

  it('试用次数用完：状态行给重置时间，不再谎报剩余', async () => {
    const h = buildHarness({
      quotaResponse: {
        success: true,
        quota: { enabled: true, remaining: 0, daily_quota: 3, resets_at: '2026-10-27T16:00:00Z' },
      },
    });
    h.setListResponse({ success: true, items: [], reason: 'not_logged_in' });
    await h.refresh();
    await new Promise((r) => setTimeout(r, 0));
    assert.match(h.status(), /今日次数已用完/);
  });
});

describe('侧边栏「刷新当前网页并重试」（OPT-20261013-019）', () => {
  const UNREACHABLE = {
    success: false,
    error: '页面联系不上插件脚本，刷新当前网页即可恢复',
    errorCode: 'PAGE_CONTEXT_UNREACHABLE',
  };

  it('生成因「联系不上插件脚本」失败：露出刷新入口，页面类型不支持则不露', async () => {
    const unreachable = buildHarness({ generateResponse: UNREACHABLE });
    await unreachable.refresh();
    await unreachable.clickGenerate();
    assert.equal(unreachable.reloadRetryBtn().hidden, false);

    const restricted = buildHarness({
      generateResponse: { success: false, error: '该页面类型不支持', errorCode: 'PAGE_CONTEXT_RESTRICTED_PAGE' },
    });
    await restricted.refresh();
    await restricted.clickGenerate();
    assert.equal(restricted.reloadRetryBtn().hidden, true, '刷新救不了的页面别给死路');
  });

  it('打开面板时探到通道不通：不用先点一次生成就把刷新入口摆出来', async () => {
    const h = buildHarness({ probeResponse: { success: true, state: 'unreachable', retryable: true } });
    await h.refresh();
    // 探测是「不挡列表」的后台动作，等它落地
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.reloadRetryBtn().hidden, false);
    assert.ok(h.actions().includes('probeAgentSuggestionsChannel'));
  });

  it('点「刷新并重试」：后台刷新成功后自动重跑一次生成', async () => {
    const h = buildHarness({ generateResponse: { success: true, created: true, projectName: '默认项目' } });
    await h.refresh();
    await h.clickReloadRetry();

    assert.equal(h.actions().filter((a) => a === 'reloadPageAndRetryAgentSuggestions').length, 1);
    assert.equal(h.actions().filter((a) => a === 'generateAgentSuggestionsForActiveTab').length, 1);
    assert.equal(h.reloadRetryBtn().hidden, true, '恢复后收起入口');
    assert.equal(h.status(), '已在「默认项目」创建优化贴');
  });

  it('刷新后通道仍不通：不重跑生成，如实报失败', async () => {
    const h = buildHarness({
      reloadResponse: { success: false, error: '页面联系不上插件脚本，刷新当前网页即可恢复', errorCode: 'PAGE_CONTEXT_UNREACHABLE' },
    });
    await h.refresh();
    await h.clickReloadRetry();

    assert.equal(h.actions().filter((a) => a === 'generateAgentSuggestionsForActiveTab').length, 0);
    assert.match(h.status(), /刷新当前网页即可恢复/);
  });
});
