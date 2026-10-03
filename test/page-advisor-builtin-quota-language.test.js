'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/page-advisor-locale-prompt.js');
require('../lib/page-advisor-llm-client.js');
require('../lib/page-advisor-builtin-runtime.js');
const builtin = require('../lib/page-advisor-builtin-prompt.js');

test('Chrome Prompt API：zh 不可用时回退到 en，避免 probe 直接 unavailable', async () => {
  const seen = [];
  const languageModel = {
    async availability(options) {
      seen.push(options);
      const lang = options
        && options.expectedInputs
        && options.expectedInputs[0]
        && options.expectedInputs[0].languages
        && options.expectedInputs[0].languages[0];
      if (lang === 'zh' || lang === 'zh-CN') return 'unavailable';
      if (lang === 'en') return 'available';
      return 'unavailable';
    },
  };
  const opts = await builtin.resolveLanguageOptions(languageModel, 'zh-CN');
  assert.deepEqual(opts.expectedInputs, [{ type: 'text', languages: ['en'] }]);
  assert.equal(await builtin.probe(languageModel, 'zh-CN'), 'available');
  assert.ok(seen.length >= 2);
});

test('measureInputUsage 返回 Promise 时仍按 token 压缩，并保留放得下的 Skill', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('builtin must not fetch'); };
  let lastPrompt = '';
  const session = {
    inputQuota: 20000,
    async measureInputUsage(text) {
      return String(text || '').length;
    },
    async prompt(text) {
      lastPrompt = String(text || '');
      return '[{"id":"s1","title":"短","summary":"摘要"}]';
    },
    destroy() {},
  };
  const model = {
    async availability() { return 'available'; },
    async create() { return session; },
  };
  try {
    const pageText = '字'.repeat(400);
    const out = await builtin.suggest(model, {
      url: 'https://example.test',
      title: '页',
      pageText,
      domOutline: [{ nid: 'n1', tag: 'button', text: '提交' }],
    }, {
      locale: 'zh-CN',
      skill: { title: 's', body: 'KEEP_SKILL' },
    });
    assert.equal(out.suggestions.length, 1);
    assert.equal(out.skippedSkill, false);
    assert.ok(lastPrompt.includes('KEEP_SKILL'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('成功生成后清掉上次 PLUGIN_BUILTIN_LLM_FAILED', async () => {
  const store = { pageAdvisorBuiltinRuntime: { lastErrorCode: 'PLUGIN_BUILTIN_LLM_FAILED', skippedSkill: true } };
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          const k = typeof key === 'string' ? key : Object.keys(key)[0];
          return { [k]: store[k] };
        },
        async set(bag) {
          Object.assign(store, bag);
        },
      },
    },
  };
  const session = {
    inputQuota: 100000,
    async measureInputUsage(text) { return String(text || '').length; },
    async prompt() { return '[{"id":"s1","title":"ok","summary":"摘要"}]'; },
    destroy() {},
  };
  const model = {
    async availability() { return 'available'; },
    async create() { return session; },
  };
  await builtin.runAltZ(1, {
    languageModel: model,
    locale: 'zh-CN',
    tx: (k) => k,
    askContext: async () => ({
      success: true,
      data: { url: 'https://example.test', title: 't', pageText: 'hello', domOutline: [] },
    }),
    notify: async () => {},
    loadSkill: async () => null,
  });
  assert.equal(store.pageAdvisorBuiltinRuntime.lastErrorCode, '');
});

test('9216 配额下 Promise 计量会裁正文；对象形态 prompt 仍能解析建议', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('builtin must not fetch'); };
  let lastPrompt = '';
  const session = {
    inputQuota: 9216,
    async measureInputUsage(text) {
      return String(text || '').length;
    },
    async prompt(text) {
      lastPrompt = String(text || '');
      return { output: '[{"id":"s1","title":"短","summary":"摘要"}]' };
    },
    destroy() {},
  };
  const model = {
    async availability(options) {
      const langTag = options
        && options.expectedInputs
        && options.expectedInputs[0]
        && options.expectedInputs[0].languages
        && options.expectedInputs[0].languages[0];
      if (langTag === 'zh') return 'unavailable';
      return 'available';
    },
    async create() { return session; },
  };
  try {
    const out = await builtin.suggest(model, {
      url: 'https://example.test',
      title: '页',
      pageText: '字'.repeat(20000),
      domOutline: [{ nid: 'n1', tag: 'button', text: '提交' }],
    }, {
      locale: 'zh-CN',
      skill: { title: 's', body: 'HUGE_SKILL_' + 'x'.repeat(8000) },
    });
    assert.equal(out.suggestions.length, 1);
    assert.ok(lastPrompt.length < 20000);
    assert.ok(out.skippedSkill);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('解析不到建议时抛 builtin_empty，失败快照不残留 skippedSkill', async () => {
  const store = { pageAdvisorBuiltinRuntime: { skippedSkill: true } };
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) {
          const k = typeof key === 'string' ? key : Object.keys(key)[0];
          return { [k]: store[k] };
        },
        async set(bag) { Object.assign(store, bag); },
      },
    },
  };
  const session = {
    inputQuota: 10000,
    async measureInputUsage(text) { return String(text || '').length; },
    async prompt() { return 'not-json'; },
    destroy() {},
  };
  const model = {
    async availability() { return 'available'; },
    async create() { return session; },
  };
  const notes = [];
  await builtin.runAltZ(1, {
    languageModel: model,
    locale: 'zh-CN',
    tx: (k) => k,
    askContext: async () => ({
      success: true,
      data: { url: 'https://example.test', title: 't', pageText: 'hello', domOutline: [] },
    }),
    notify: async function (tabId, payload) { notes.push(payload); },
    loadSkill: async () => null,
  });
  const last = notes[notes.length - 1];
  assert.equal(last.ok, false);
  assert.equal(last.errorCode, 'builtin_empty');
  assert.equal(last.error, 'paEmpty');
  assert.equal(store.pageAdvisorBuiltinRuntime.skippedSkill, false);
});
