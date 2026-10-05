'use strict';

/**
 * 本机模型 suggest 须把原整段 builtin 拆成可观测子阶段（探测/建会话/裁剪/推理/解析）。
 */
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

describe('PageAdvisorBuiltinSuggest spans', () => {
  let builtin;
  let Timing;

  before(() => {
    require('../lib/page-advisor-llm-client.js');
    require('../lib/page-advisor-builtin-language.js');
    require('../lib/page-advisor-builtin-fit.js');
    Timing = require('../lib/page-advisor-timing.js');
    builtin = require('../lib/page-advisor-builtin-prompt.js');
  });

  it('SPAN_IDS lists builtin sub-stages and waterfall labels cover them', () => {
    const View = require('../lib/page-advisor-waterfall-view.js');
    for (const id of [
      'builtin_probe',
      'builtin_create',
      'builtin_fit',
      'builtin_infer',
      'builtin_parse',
      'network_wait',
      'network_download',
    ]) {
      assert.ok(Timing.SPAN_IDS.includes(id), `missing SPAN_IDS ${id}`);
      assert.ok(View.LABEL_KEYS[id], `missing LABEL_KEYS ${id}`);
    }
  });

  it('suggest records probe→create→fit→infer→parse and not a parent builtin wrap', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('builtin must not fetch'); };
    let t = 1000;
    const now = () => t;
    const run = Timing.createRun({
      runId: 'r-builtin-spans',
      command: 'alt-shift-z',
      route: 'builtin',
      now,
    });
    const withSpan = async (id, fn) => {
      t += 1;
      return Timing.withSpan(run, id, now, async () => {
        t += 10;
        return fn();
      });
    };
    const session = {
      inputQuota: 100000,
      measureInputUsage: (text) => String(text).length,
      async prompt() {
        t += 50;
        return '[{"id":"s1","title":"标题","summary":"摘要","detail":"详情","category":"ux","target_nid":"n1","anchor_text":"按钮"}]';
      },
      destroy() {},
    };
    const model = {
      async availability() { return 'available'; },
      async params() { return { defaultTopK: 3, maxTemperature: 1 }; },
      async create() { return session; },
    };
    try {
      const out = await builtin.suggest(model, {
        url: 'https://example.test',
        title: '页',
        pageText: '按钮',
        domOutline: [{ nid: 'n1', tag: 'button', text: '按钮' }],
      }, { locale: 'zh-CN', skill: null, withSpan });
      assert.equal(out.suggestions.length, 1);
      assert.deepEqual(run.spans.map((s) => s.id), [
        'builtin_probe',
        'builtin_create',
        'builtin_fit',
        'builtin_infer',
        'builtin_parse',
      ]);
      assert.equal(run.spans.every((s) => s.status === 'ok'), true);
      assert.equal(run.spans.some((s) => s.id === 'builtin'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('runAltZ passes withSpan into suggest (no single builtin parent)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('builtin must not fetch'); };
    const spanIds = [];
    const withSpan = async (id, fn) => {
      spanIds.push(id);
      return fn();
    };
    const session = {
      inputQuota: 100000,
      measureInputUsage: () => 1,
      async prompt() {
        return '[{"id":"s1","title":"t","summary":"s"}]';
      },
      destroy() {},
    };
    const model = {
      async availability() { return 'available'; },
      async params() { return {}; },
      async create() { return session; },
    };
    const notes = [];
    try {
      await builtin.runAltZ(1, {
        languageModel: model,
        askContext: async () => ({
          success: true,
          data: {
            url: 'https://example.test',
            title: 't',
            pageText: 'x',
            domOutline: [],
          },
        }),
        notify: async (_tabId, payload) => { notes.push(payload); },
        loadSkill: async () => null,
        locale: 'zh-CN',
        tx: (k) => k,
        withSpan,
      });
      assert.ok(notes.some((n) => n && n.ok && n.phase === 'done'));
      assert.deepEqual(spanIds.filter((id) => String(id).startsWith('builtin')), [
        'builtin_probe',
        'builtin_create',
        'builtin_fit',
        'builtin_infer',
        'builtin_parse',
      ]);
      assert.equal(spanIds.includes('builtin'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
