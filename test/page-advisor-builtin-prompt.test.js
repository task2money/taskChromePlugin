const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
require('../lib/page-advisor-builtin-enable.js');
const builtin = require('../lib/page-advisor-builtin-prompt.js');

test('界面语言只映射成 zh 或 en', () => {
  assert.equal(builtin.promptLanguage('zh-CN'), 'zh');
  assert.equal(builtin.promptLanguage('zh'), 'zh');
  assert.equal(builtin.promptLanguage('en'), 'en');
  assert.equal(builtin.promptLanguage('en-US'), 'en');
});

test('availability、create、prompt 收到同一份语言选项', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      return 'available';
    },
    async create(options) {
      seen.push(options);
      return {
        async prompt(_text, options) {
          seen.push(options);
          return '建议';
        },
        destroy() {},
      };
    },
  };

  const out = await builtin.run(languageModel, 'zh-CN', '这段按钮文案');
  assert.equal(out.availability, 'available');
  assert.equal(out.result, '建议');
  assert.ok(seen.length >= 3);
  assert.equal(seen[0], seen[1]);
  assert.deepEqual(seen[0], {
    expectedInputs: [{ type: 'text', languages: ['zh'] }],
    expectedOutputs: [{ type: 'text', languages: ['zh'] }],
  });
});

test('英文界面三次仍是同一对象', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      return 'available';
    },
    async create(options) {
      seen.push(options);
      return {
        async prompt(_text, promptOptions) {
          seen.push(promptOptions);
          return 'ok';
        },
      };
    },
  };

  await builtin.run(languageModel, 'en-GB', 'label');
  assert.equal(seen[0], seen[1]);
  assert.deepEqual(seen[0].expectedInputs, [{ type: 'text', languages: ['en'] }]);
});

test('不可用时不创建会话', async () => {
  let created = false;
  const languageModel = {
    async availability() {
      return 'downloadable';
    },
    async create() {
      created = true;
      return { async prompt() { return ''; } };
    },
  };
  const out = await builtin.run(languageModel, 'zh', 'x');
  assert.equal(out.availability, 'downloadable');
  assert.equal(created, false);
});

test('超配额时先缩短可见文本，再丢掉非交互大纲，并保留可交互 nid', async () => {
  const page = {
    pageText: '字'.repeat(2000),
    domOutline: [
      { nid: 'keep', tag: 'button', text: '提交' },
      { nid: 'drop', tag: 'div', text: '说明' },
    ],
  };
  const measure = (p) => Array.from(p.pageText).length + p.domOutline.length * 80;
  const out = await builtin.shrinkPage(page, measure, 200);
  assert.ok(out.usage <= 200);
  assert.ok(out.page.domOutline.some((node) => node.nid === 'keep'));
  assert.equal(out.page.domOutline.some((node) => node.nid === 'drop'), false);
});

test('Skill 放不下时省略，放得下时保留', async () => {
  const page = { pageText: 'hello', domOutline: [] };
  const skill = { title: 's', body: 'SKILLBODY' };
  const skipped = await builtin.fitPrompt(page, skill, 'zh-CN', (text) => (
    String(text).includes('SKILLBODY') ? 50 : 10
  ), 20);
  assert.equal(skipped.skippedSkill, true);
  assert.equal(String(skipped.prompt).includes('SKILLBODY'), false);
  const kept = await builtin.fitPrompt(page, skill, 'zh-CN', () => 10, 20);
  assert.equal(kept.skippedSkill, false);
  assert.equal(String(kept.prompt).includes('SKILLBODY'), true);
});

test('available 时解析建议且不发起 fetch；schema 被拒绝则去掉约束再试', async () => {
  require('../lib/page-advisor-llm-client.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('builtin must not fetch'); };
  const prompts = [];
  const session = {
    inputQuota: 100000,
    measureInputUsage: (text) => String(text).length,
    async prompt(text, opts) {
      prompts.push(opts || null);
      if (opts && opts.responseConstraint) throw new Error('schema rejected');
      return '[{"id":"s1","title":"标题","summary":"摘要","detail":"详情","category":"ux","target_nid":"n1","anchor_text":"按钮"}]';
    },
    destroy() { prompts.push('destroy'); },
  };
  let createOpts = null;
  const model = {
    async availability() { return 'available'; },
    async params() { return { defaultTopK: 3, maxTemperature: 1 }; },
    async create(opts) {
      createOpts = opts;
      return session;
    },
  };
  try {
    const out = await builtin.suggest(model, {
      url: 'https://example.test',
      title: '页',
      pageText: '按钮',
      domOutline: [{ nid: 'n1', tag: 'button', text: '按钮' }],
    }, { locale: 'zh-CN', skill: null });
    assert.equal(out.suggestions.length, 1);
    assert.equal(out.suggestions[0].title, '标题');
    assert.equal(createOpts.temperature, 0.3);
    assert.equal(createOpts.topK, 3);
    assert.equal(prompts.filter((item) => item && item.responseConstraint).length, 1);
    assert.equal(prompts.some((item) => item && !item.responseConstraint && item.expectedInputs), true);
    assert.equal(prompts.includes('destroy'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('downloading 的 Alt+Z 不 create，错误码与尚未下载区分', async () => {
  let created = 0;
  const model = {
    async availability() { return 'downloading'; },
    async create() {
      created += 1;
      return { destroy() {} };
    },
  };
  await assert.rejects(
    () => builtin.suggest(model, { pageText: 'x', domOutline: [] }, { allowCreate: false }),
    (err) => err.code === 'builtin_downloading' && err.availability === 'downloading',
  );
  assert.equal(created, 0);
});

test('runAltZ 在 downloading 100% 时与设置页同一句，不说尚未下载', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {
    [runtime.STORAGE_KEY]: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      updatedAt: Date.now(),
    },
  };
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
  };
  const notes = [];
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  try {
    await builtin.runAltZ(1, {
      languageModel: {
        async availability() { return 'downloading'; },
        async create() { throw new Error('should not create'); },
      },
      askContext: async () => ({
        success: true,
        data: { url: 'https://example.test', title: 't', pageText: 'p', domOutline: [] },
      }),
      notify: async (_tab, payload) => { notes.push(payload); },
      tx,
      locale: 'zh-CN',
    });
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
  const failed = notes.find((item) => item && item.ok === false);
  assert.ok(failed);
  assert.equal(failed.error, 'paBuiltinDownloadNeedEnable:100');
  assert.notEqual(failed.error, 'paBuiltinNeedsDownload');
  assert.equal(failed.errorCode, 'builtin_downloading');
});

test('Prompt API 的 downloadprogress.loaded 为 0..1 时按百分比上报', async () => {
  const progress = [];
  const downloadModel = {
    async availability() { return 'downloadable'; },
    async create(opts) {
      opts.monitor({
        addEventListener(name, fn) {
          if (name === 'downloadprogress') fn({ loaded: 0.4 });
        },
      });
      return { destroy() {} };
    },
  };
  await builtin.startDownload(downloadModel, 'zh-CN', { onProgress: (pct) => progress.push(pct) });
  assert.deepEqual(progress, [40]);
});

test('startDownload 在 100% 解压载入期间标记 downloadInFlight', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {};
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
  };
  let midSnap = null;
  const downloadModel = {
    async create(opts) {
      opts.monitor({
        addEventListener(name, fn) {
          if (name === 'downloadprogress') fn({ loaded: 1, total: 1 });
        },
      });
      await new Promise((r) => setTimeout(r, 20));
      midSnap = bag[runtime.STORAGE_KEY];
      return { destroy() {} };
    },
  };
  try {
    await builtin.startDownload(downloadModel, 'zh-CN', {});
    assert.equal(midSnap.downloadInFlight, true);
    assert.equal(midSnap.downloadPct, 100);
    const done = bag[runtime.STORAGE_KEY];
    assert.equal(done.downloadInFlight, false);
    assert.equal(done.availability, 'available');
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('downloadable 的 Alt+Z 不 create；设置允许时才 create', async () => {
  let created = 0;
  const model = {
    async availability() { return 'downloadable'; },
    async create() {
      created += 1;
      return { inputQuota: 100, async prompt() { return '[]'; }, destroy() {} };
    },
  };
  await assert.rejects(
    () => builtin.suggest(model, { pageText: 'x', domOutline: [] }, { allowCreate: false }),
    (err) => err.code === 'builtin_needs_download',
  );
  assert.equal(created, 0);
  const progress = [];
  const downloadModel = {
    async availability() { return 'downloadable'; },
    async create(opts) {
      created += 1;
      opts.monitor({
        addEventListener(name, fn) {
          if (name === 'downloadprogress') fn({ loaded: 1, total: 4 });
        },
      });
      return { destroy() {} };
    },
  };
  await builtin.startDownload(downloadModel, 'zh-CN', { onProgress: (pct) => progress.push(pct) });
  assert.equal(created, 1);
  assert.deepEqual(progress, [25]);
});

test('cancelDownload 会 abort 进行中的下载', async () => {
  let aborted = false;
  const downloadModel = {
    async availability() { return 'downloadable'; },
    async create(opts) {
      return new Promise((resolve, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
      });
    },
  };
  const pending = builtin.startDownload(downloadModel, 'zh-CN', {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(builtin.cancelDownload(), true);
  await assert.rejects(() => pending);
  assert.equal(aborted, true);
});

test('startDownload 在 await availability 之前就必须调用 create（保留用户激活）', async () => {
  let created = 0;
  let createStarted = null;
  const downloadModel = {
    async availability() {
      // 若实现先 await availability，create 永远不会开始 → 用户激活已丢失
      return new Promise(() => {});
    },
    async create(opts) {
      created += 1;
      createStarted = opts;
      return new Promise((resolve, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        }
      });
    },
  };
  const pending = builtin.startDownload(downloadModel, 'zh-CN', {});
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created, 1, 'create 必须在 availability 完成前启动，否则 Chrome 会因无用户激活拒绝下载');
  assert.ok(createStarted && createStarted.signal, 'create 须带 AbortSignal 以支持取消');
  assert.equal(builtin.cancelDownload(), true);
  await assert.rejects(() => pending);
});

test('askContext 挂起时 runAltZ 超时并通知失败', async () => {
  const { withTimeout } = require('../lib/async-timeout.js');
  globalThis.withTimeout = withTimeout;
  globalThis.tx = (key) => key;
  const notes = [];
  const started = Date.now();
  await builtin.runAltZ(1, {
    languageModel: {
      async availability() { return 'available'; },
      async create() { throw new Error('should not create'); },
    },
    askContext: () => new Promise(() => {}),
    askContextTimeoutMs: 40,
    notify: async (_tab, payload) => { notes.push(payload); },
    tx: (key) => key,
    locale: 'zh-CN',
  });
  assert.ok(Date.now() - started < 2000);
  const failed = notes.find((item) => item && item.ok === false);
  assert.ok(failed);
  assert.equal(failed.errorCode, 'PLUGIN_BUILTIN_CONTEXT');
});

test('内置失败通知不含页面原文', async () => {
  const secret = '页面机密原文-不应出现';
  const notes = [];
  await builtin.runAltZ(1, {
    languageModel: {
      async availability() { return 'unavailable'; },
      async create() { throw new Error('should not create'); },
    },
    askContext: async () => ({
      success: true,
      data: { url: 'https://example.test', title: 't', pageText: secret, domOutline: [] },
    }),
    notify: async (_tab, payload) => { notes.push(payload); },
    tx: (key) => key,
    locale: 'zh-CN',
  });
  const failed = notes.find((item) => item && item.ok === false);
  assert.ok(failed);
  assert.equal(JSON.stringify(failed).includes(secret), false);
  assert.equal(JSON.stringify(failed).includes('apiKey'), false);
});

test('startDownload 100% 后超时 abort（enableTimeoutMs）', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {};
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
  };
  let aborted = false;
  const downloadModel = {
    async create(opts) {
      opts.monitor({
        addEventListener(name, fn) {
          if (name === 'downloadprogress') fn({ loaded: 1, total: 1 });
        },
      });
      return new Promise((_, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        }
      });
    },
  };
  try {
    await assert.rejects(
      () => builtin.startDownload(downloadModel, 'zh-CN', { enableTimeoutMs: 30 }),
    );
    assert.equal(aborted, true);
    const done = bag[runtime.STORAGE_KEY];
    assert.equal(done.downloadInFlight, false);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('abandonEnable 后 runAltZ 提示尚未启用（T4）', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {};
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
  };
  const hanging = {
    async availability() { return 'downloading'; },
    async create(opts) {
      opts.monitor({
        addEventListener(name, fn) {
          if (name === 'downloadprogress') fn({ loaded: 1, total: 1 });
        },
      });
      return new Promise((_, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          }, { once: true });
        }
      });
    },
  };
  const pending = builtin.startDownload(hanging, 'zh-CN', {});
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(builtin.abandonEnable(), true);
  await assert.rejects(() => pending);
  const notes = [];
  const tx = (k, vars) => (vars && vars.pct != null ? `${k}:${vars.pct}` : k);
  try {
    await builtin.runAltZ(1, {
      languageModel: {
        async availability() { return 'downloading'; },
        async create() { throw new Error('should not create'); },
      },
      askContext: async () => ({
        success: true,
        data: { url: 'https://example.test', title: 't', pageText: 'p', domOutline: [] },
      }),
      notify: async (_tab, payload) => { notes.push(payload); },
      tx,
      locale: 'zh-CN',
      enablePollMs: 0,
    });
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
  const failed = notes.find((item) => item && item.ok === false);
  assert.ok(failed);
  assert.equal(failed.error, 'paBuiltinDownloadNeedEnable:100');
  assert.match(String(failed.errorCode), /builtin_downloading|builtin_needs_download/);
});

test('inFlight 未超时 runAltZ 等到 available 后给出建议（T5）', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  require('../lib/page-advisor-builtin-enable.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevLlm = globalThis.PageAdvisorLLM;
  const prevChrome = globalThis.chrome;
  const bag = {
    [runtime.STORAGE_KEY]: {
      phase: 'downloading',
      availability: 'downloading',
      downloadPct: 100,
      downloadInFlight: true,
      enableStartedAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.PageAdvisorLLM = {
    parseSuggestionsJSON: () => [{ id: '1', title: 't', summary: 's' }],
    buildChatMessages: (page) => [{ role: 'user', content: page.pageText }],
  };
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
  };
  let probes = 0;
  const notes = [];
  try {
    await builtin.runAltZ(1, {
      languageModel: {
        async availability() {
          probes += 1;
          return probes < 2 ? 'downloading' : 'available';
        },
        async create() {
          return {
            inputQuota: 8000,
            measureInputUsage: (text) => String(text || '').length,
            async prompt() { return '[]'; },
            destroy() {},
          };
        },
      },
      askContext: async () => ({
        success: true,
        data: { url: 'https://example.test', title: 't', pageText: 'p', domOutline: [] },
      }),
      notify: async (_tab, payload) => { notes.push(payload); },
      tx: (k, vars) => k + (vars && vars.sec != null ? `:${vars.sec}` : ''),
      locale: 'zh-CN',
      enablePollMs: 10,
      enableTimeoutMs: 2000,
    });
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.PageAdvisorLLM = prevLlm;
    globalThis.chrome = prevChrome;
  }
  const done = notes.find((item) => item && item.ok === true && item.phase === 'done');
  assert.ok(done, JSON.stringify(notes));
  assert.equal(done.suggestions.length, 1);
  assert.ok(probes >= 2);
});

test('内容脚本源码不引用 LanguageModel', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
  for (const group of manifest.content_scripts || []) {
    for (const rel of group.js || []) {
      const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      assert.equal(/\bLanguageModel\b/.test(text), false, rel);
    }
  }
});

test('Service Worker 在访客门闩之前处理 builtin', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sw = fs.readFileSync(path.join(__dirname, '../background/sw-page-advisor.js'), 'utf8');
  const builtinAt = sw.indexOf("route === 'builtin'");
  const guestAt = sw.indexOf('!directReady && !sessionOk');
  assert.ok(builtinAt > 0);
  assert.ok(guestAt > builtinAt);
  assert.match(sw, /withTimeout\(p, 12000/);
});

test('OPT-20261003-019: 非 owner 广播取消 → owner 上下文 abort 并写回快照', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {};
  const listeners = [];
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
    runtime: {
      onMessage: { addListener(fn) { listeners.push(fn); } },
      sendMessage() { return Promise.resolve({ success: true }); },
    },
  };
  let aborted = false;
  const downloadModel = {
    async create(opts) {
      return new Promise((resolve, reject) => {
        const signal = opts && opts.signal;
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }
      });
    },
  };
  try {
    const pending = builtin.startDownload(downloadModel, 'zh-CN', {});
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(listeners.length, 1, 'owner 上下文应安装取消中继监听');
    const mid = bag[runtime.STORAGE_KEY];
    assert.ok(mid && mid.enableOwner, '启动下载应登记 owner 上下文（enableOwner）');
    // 模拟侧栏/设置页另一上下文广播取消
    listeners[0]({ type: 'builtinDownloadCancel' });
    await assert.rejects(() => pending);
    assert.equal(aborted, true);
    const done = bag[runtime.STORAGE_KEY];
    assert.equal(done.downloadInFlight, false);
    assert.equal(done.lastErrorCode, 'download_aborted');
    assert.equal(done.enableOwner, '');
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('OPT-20261003-019: 无本地下载时 cancelDownload 广播 builtinDownloadCancel', async () => {
  const prevChrome = globalThis.chrome;
  const sent = [];
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(msg) { sent.push(msg); return Promise.resolve({ success: true }); },
    },
  };
  try {
    const ok = builtin.cancelDownload();
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].action, 'builtinDownloadCancel');
    assert.equal(sent[0].type, 'builtinDownloadCancel');
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test('OPT-20261003-019: 非 owner 收到广播不误 abort（无进行中下载时无副作用）', async () => {
  const runtime = require('../lib/page-advisor-builtin-runtime.js');
  const prevRuntime = globalThis.PageAdvisorBuiltinRuntime;
  const prevChrome = globalThis.chrome;
  const bag = {};
  const listeners = [];
  globalThis.PageAdvisorBuiltinRuntime = runtime;
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return { [key]: bag[key] }; },
        async set(next) { Object.assign(bag, next); },
      },
    },
    runtime: {
      onMessage: { addListener(fn) { listeners.push(fn); } },
      sendMessage() { return Promise.resolve({ success: true }); },
    },
  };
  try {
    const model = { async create() { return { destroy() {} }; } };
    await builtin.startDownload(model, 'zh-CN', {});
    assert.equal(bag[runtime.STORAGE_KEY].availability, 'available');
    assert.equal(listeners.length, 1);
    // 下载已完成，owner 已释放；广播与无关消息都不应改变快照
    listeners[0]({ type: 'other' });
    listeners[0]({ type: 'builtinDownloadCancel' });
    assert.equal(bag[runtime.STORAGE_KEY].availability, 'available');
    assert.equal(bag[runtime.STORAGE_KEY].downloadInFlight, false);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('OPT-20261003-019: Service Worker 认识 builtinDownloadCancel 广播', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sw = fs.readFileSync(path.join(__dirname, '../background/sw-messages-session.js'), 'utf8');
  assert.match(sw, /case 'builtinDownloadCancel'/);
  assert.match(sw, /relayed: true/);
});
