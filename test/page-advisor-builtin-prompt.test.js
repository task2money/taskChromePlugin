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

test('重复 100% downloadprogress 不得把解压进度打回 1', async () => {
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
  const extras = [];
  let fire100 = null;
  const downloadModel = {
    availability: async () => 'downloading',
    create(opts) {
      opts.monitor({
        addEventListener(name, fn) {
          if (name !== 'downloadprogress') return;
          fn({ loaded: 1, total: 1 });
          fire100 = () => fn({ loaded: 1, total: 1 });
        },
      });
      return new Promise((resolve) => {
        setTimeout(() => resolve({ destroy() {} }), 900);
      });
    },
  };
  try {
    const pending = builtin.startDownload(downloadModel, 'zh-CN', {
      enableHeartbeatMs: 15,
      enableTimeoutMs: 5000,
      onProgress(pct, extra) { extras.push({ pct, extra }); },
    });
    await new Promise((r) => setTimeout(r, 700));
    if (typeof fire100 === 'function') fire100();
    await new Promise((r) => setTimeout(r, 40));
    const grown = extras.filter((e) => e.pct === 100 && e.extra && Number(e.extra.loadPct) > 1);
    assert.ok(grown.length >= 1, JSON.stringify(extras.slice(-5)));
    const afterRepeat = extras[extras.length - 1];
    assert.equal(afterRepeat.pct, 100);
    assert.ok(afterRepeat.extra && Number(afterRepeat.extra.loadPct) > 1, JSON.stringify(afterRepeat));
    await pending;
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('解压期间 availability 变 available 则结束启用并进入就绪', async () => {
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
  let av = 'downloading';
  const downloadModel = {
    async availability() { return av; },
    create(opts) {
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
  try {
    const pending = builtin.startDownload(downloadModel, 'zh-CN', {
      enableHeartbeatMs: 15,
      enableTimeoutMs: 5000,
      probe: async () => av,
    });
    await new Promise((r) => setTimeout(r, 25));
    const mid = bag[runtime.STORAGE_KEY];
    assert.equal(mid.downloadInFlight, true);
    assert.ok(Number(mid.enablePct) >= 1);
    av = 'available';
    const result = await pending;
    assert.equal(result.availability, 'available');
    const done = bag[runtime.STORAGE_KEY];
    assert.equal(done.downloadInFlight, false);
    assert.equal(done.availability, 'available');
    assert.equal(done.enablePct, 100);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
});

test('downloadable 时 startDownload 才 create 并上报进度', async () => {
  let created = 0;
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
  const pending = builtin.startDownload(downloadModel, 'zh-CN', { enableHeartbeatMs: 0 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(created, 1, 'create 必须在 availability 完成前启动，否则 Chrome 会因无用户激活拒绝下载');
  assert.ok(createStarted && createStarted.signal, 'create 须带 AbortSignal 以支持取消');
  assert.equal(builtin.cancelDownload(), true);
  await assert.rejects(() => pending);
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

test('abandonEnable 中止进行中的启用并写回快照（T4）', async () => {
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
  try {
    assert.equal(builtin.abandonEnable(), true);
    await assert.rejects(() => pending);
    const done = bag[runtime.STORAGE_KEY];
    assert.equal(done.downloadInFlight, false);
    assert.match(String(done.lastErrorCode), /enable_orphaned|download_aborted/);
  } finally {
    globalThis.PageAdvisorBuiltinRuntime = prevRuntime;
    globalThis.chrome = prevChrome;
  }
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

test('生成核心只保留平台后端与匿名试用，不再有直连/内置分流', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sw = fs.readFileSync(path.join(__dirname, '../background/sw-page-advisor.js'), 'utf8');
  const core = fs.readFileSync(path.join(__dirname, '../background/sw-page-advisor-generate.js'), 'utf8');
  assert.equal(sw.includes("route === 'builtin'"), false, 'Alt+Z 入口不再自带 runAltZ 分支');
  assert.equal(sw.includes("route === 'direct'"), false);
  assert.ok(sw.indexOf('generatePageAdvisorSuggestions(tabId') > 0);
  assert.equal(core.includes("route === 'builtin'"), false);
  assert.equal(core.includes("route === 'direct'"), false);
  assert.match(core, /const trialMode = !sessionOk;/);
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
