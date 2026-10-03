const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
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
  assert.equal(seen.length, 3);
  assert.equal(seen[0], seen[1]);
  assert.equal(seen[1], seen[2]);
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
  assert.equal(seen[1], seen[2]);
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

test('超配额时先缩短可见文本，再丢掉非交互大纲，并保留可交互 nid', () => {
  const page = {
    pageText: '字'.repeat(2000),
    domOutline: [
      { nid: 'keep', tag: 'button', text: '提交' },
      { nid: 'drop', tag: 'div', text: '说明' },
    ],
  };
  const measure = (p) => Array.from(p.pageText).length + p.domOutline.length * 80;
  const out = builtin.shrinkPage(page, measure, 200);
  assert.ok(out.usage <= 200);
  assert.ok(out.page.domOutline.some((node) => node.nid === 'keep'));
  assert.equal(out.page.domOutline.some((node) => node.nid === 'drop'), false);
});

test('Skill 放不下时省略，放得下时保留', () => {
  const page = { pageText: 'hello', domOutline: [] };
  const skill = { title: 's', body: 'SKILLBODY' };
  const skipped = builtin.fitPrompt(page, skill, 'zh-CN', (text) => (
    String(text).includes('SKILLBODY') ? 50 : 10
  ), 20);
  assert.equal(skipped.skippedSkill, true);
  assert.equal(String(skipped.prompt).includes('SKILLBODY'), false);
  const kept = builtin.fitPrompt(page, skill, 'zh-CN', () => 10, 20);
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
