'use strict';

/**
 * 直连 LLM 调用账本（OPT-20261015-022）。
 *
 * 这条链路的特殊性在于「用户自填 Key 直连」在平台侧完全不可见，账本是唯一的证据
 * 来源，因此两类断言必须钉死：
 * 1. **安全**：入参里塞 key / 正文 / 带令牌的 URL，落库结果里都不能出现；
 * 2. **口径**：usage 的包含式 → exclusive 换算（input 不含缓存命中）与三形态兼容，
 *    算错会让账本上的输入/output 与实际计费对不上，比不记更坏。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const Ledger = require('../lib/llm-call-ledger.js');

/** 内存版 chrome.storage.local（get/set 往返是深拷贝，避免测试里改到同一引用）。 */
function memoryStorage(seed = {}) {
  let data = JSON.parse(JSON.stringify(seed));
  return {
    _dump: () => data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      return JSON.parse(JSON.stringify(out));
    },
    async set(obj) {
      data = { ...data, ...JSON.parse(JSON.stringify(obj)) };
    },
  };
}

const FIXED_NOW = () => '2026-10-16T05:00:00.000Z';
const FIXED_ID = () => 'entry-fixed-1';

describe('PageAdvisorLLMLedger 安全边界', () => {
  it('只落白名单字段：key 与正文不入账，主机只留 host', async () => {
    const storage = memoryStorage();
    const ok = await Ledger.recordCall(
      {
        source: 'direct',
        // 兼容端点常把 key 放 query，完整 URL 绝不能进账本。
        baseUrl: 'https://api.openai.com/v1?api_key=sk-secret-123',
        model: 'gpt-x',
        ok: true,
        status: 200,
        durationMs: 1234,
        responseText: JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 20 },
          // 正文也在同一个回包里：它同样不得进账本。
          choices: [{ message: { content: '页面正文里的敏感片段' } }],
        }),
      },
      { storage, now: FIXED_NOW, uuid: FIXED_ID },
    );
    assert.equal(ok, true);

    const raw = JSON.stringify(storage._dump());
    assert.ok(!raw.includes('sk-secret-123'), 'api key 泄漏进账本');
    assert.ok(!raw.includes('敏感片段'), '模型正文泄漏进账本');

    const [entry] = await Ledger.listCalls({ storage });
    assert.equal(entry.host, 'api.openai.com', '只应保留主机名');
    assert.equal(entry.model, 'gpt-x');
    assert.equal(entry.ok, true);
    assert.equal(entry.status, 200);
    assert.equal(entry.durationMs, 1234);
    assert.equal(entry.at, '2026-10-16T05:00:00.000Z');
    assert.equal(entry.id, 'entry-fixed-1');
    assert.deepEqual(entry.tokens, { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 });
  });

  it('storage 不可用（无 chrome / 配额异常）时静默失败，不抛给调用方', async () => {
    assert.equal(await Ledger.recordCall({ source: 'direct' }, { storage: null }), false);
    const broken = {
      async get() { throw new Error('quota'); },
      async set() { throw new Error('quota'); },
    };
    assert.equal(await Ledger.recordCall({ source: 'direct' }, { storage: broken }), false);
  });
});

describe('PageAdvisorLLMLedger usage 口径', () => {
  it('chat.completions：input 扣掉缓存命中（exclusive）', () => {
    const usage = Ledger.normalizeUsage({
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 800 },
      },
    });
    assert.deepEqual(usage, { input: 200, output: 50, cacheRead: 800, cacheCreation: 0 });
  });

  it('DeepSeek：prompt_cache_hit_tokens 作缓存命中，miss 作缓存创建', () => {
    const usage = Ledger.normalizeUsage(JSON.stringify({
      usage: {
        prompt_tokens: 500,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 400,
        prompt_cache_miss_tokens: 100,
      },
    }));
    assert.deepEqual(usage, { input: 100, output: 10, cacheRead: 400, cacheCreation: 100 });
  });

  it('input_tokens 形态（Responses / anthropic 风格）同样归一', () => {
    const usage = Ledger.normalizeUsage({
      usage: {
        input_tokens: 300,
        output_tokens: 40,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 60,
      },
    });
    assert.deepEqual(usage, { input: 200, output: 40, cacheRead: 100, cacheCreation: 60 });
  });

  it('未回 usage / 空对象 / 坏 JSON 一律 null（未记录），不假装零消耗', () => {
    assert.equal(Ledger.normalizeUsage('not json'), null);
    assert.equal(Ledger.normalizeUsage({}), null);
    assert.equal(Ledger.normalizeUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } }), null);
    assert.equal(Ledger.normalizeUsage(null), null);
  });

  it('cached > prompt 的畸形回包不产生负数输入', () => {
    const usage = Ledger.normalizeUsage({
      usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 99 } },
    });
    assert.equal(usage.input, 0);
  });
});

describe('PageAdvisorLLMLedger 环形缓冲', () => {
  it('超过上限只保留最新的 MAX_ENTRIES 条，且导出为「新在前」', async () => {
    const storage = memoryStorage();
    let seq = 0;
    for (let i = 0; i < Ledger.MAX_ENTRIES + 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await Ledger.recordCall(
        { source: 'direct', baseUrl: 'https://api.deepseek.com', model: `m${i}`, ok: true },
        { storage, now: FIXED_NOW, uuid: () => `id-${seq++}` },
      );
    }
    const all = await Ledger.listCalls({ storage });
    assert.equal(all.length, Ledger.MAX_ENTRIES);
    assert.equal(all[0].model, `m${Ledger.MAX_ENTRIES + 2}`, '最新的排在最前');
    assert.equal(all[all.length - 1].model, 'm3', '最旧的三条被挤掉');
  });

  it('clear 清空后账本为空，导出仍是合法 JSON', async () => {
    const storage = memoryStorage();
    await Ledger.recordCall({ source: 'probe', baseUrl: 'https://api.openai.com/v1' }, { storage });
    assert.equal((await Ledger.listCalls({ storage })).length, 1);

    assert.equal(await Ledger.clearCalls({ storage }), true);
    assert.deepEqual(await Ledger.listCalls({ storage }), []);

    const text = await Ledger.exportJSON({ storage });
    const parsed = JSON.parse(text.replace(/^﻿/, ''));
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.entries, []);
  });

  it('探针调用只记主机与结果（source=probe，无 tokens）', async () => {
    const storage = memoryStorage();
    await Ledger.recordCall(
      {
        source: 'probe',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        ok: false,
        status: 401,
        durationMs: 88,
      },
      { storage, now: FIXED_NOW, uuid: FIXED_ID },
    );
    const [entry] = await Ledger.listCalls({ storage });
    assert.equal(entry.source, 'probe');
    assert.equal(entry.host, 'api.deepseek.com');
    assert.equal(entry.ok, false);
    assert.equal(entry.status, 401);
    assert.equal(entry.tokens, null);
  });
});
