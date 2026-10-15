'use strict';

/**
 * 直连账本的接线回归（OPT-20261015-022）。
 *
 * 单测账本本身只证明「记账正确」；真正会静默失效的是**接线**：客户端与探针各自在
 * 成功、HTTP 失败、网络失败三条出口上调没调记账。漏掉任何一条，账本都会给出「这个
 * Key 从没出去过」的错误结论——比没有账本更坏，因为它看起来像证据。
 *
 * 这里不打桩账本，而是把内存版 chrome.storage.local 挂到 globalThis.chrome 上，
 * 让真实链路（client → PageAdvisorLLMLedger → storage）整体跑一遍。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const Ledger = require('../lib/llm-call-ledger.js');
const PageAdvisorLLM = require('../lib/page-advisor-llm-client.js');
const Probe = require('../lib/page-advisor-llm-probe.js');

function memoryStorage() {
  let data = {};
  return {
    dump: () => data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
      return out;
    },
    async set(obj) {
      data = { ...data, ...obj };
    },
  };
}

const CHAT_OK_BODY = JSON.stringify({
  choices: [{ message: { content: '[{"title":"Idea","summary":"ok"}]' } }],
  usage: { prompt_tokens: 1000, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 700 } },
});

let storage;
let savedChrome;
let savedLedger;

beforeEach(() => {
  storage = memoryStorage();
  savedChrome = globalThis.chrome;
  savedLedger = globalThis.PageAdvisorLLMLedger;
  globalThis.chrome = { storage: { local: storage } };
  globalThis.PageAdvisorLLMLedger = Ledger;
});

afterEach(() => {
  globalThis.chrome = savedChrome;
  if (savedLedger === undefined) delete globalThis.PageAdvisorLLMLedger;
  else globalThis.PageAdvisorLLMLedger = savedLedger;
});

describe('直连分析（suggest）落账本', () => {
  it('成功调用记一条：主机、模型、状态、时长与 exclusive 口径的 tokens', async () => {
    await PageAdvisorLLM.suggest(
      { apiKey: 'sk-abc', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      {
        hostConfirmed: true,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => CHAT_OK_BODY }),
      },
    );

    const entries = await Ledger.listCalls();
    assert.equal(entries.length, 1);
    const [entry] = entries;
    assert.equal(entry.source, 'direct');
    assert.equal(entry.host, 'api.deepseek.com');
    assert.equal(entry.model, 'deepseek-chat');
    assert.equal(entry.ok, true);
    assert.equal(entry.status, 200);
    assert.ok(entry.durationMs >= 0);
    // input 已扣掉缓存命中：1000 - 700。
    assert.deepEqual(entry.tokens, { input: 300, output: 30, cacheRead: 700, cacheCreation: 0 });
    // Key 与页面正文都不得进账本。
    const raw = JSON.stringify(storage.dump());
    assert.doesNotMatch(raw, /sk-abc/);
    assert.doesNotMatch(raw, /body/);
  });

  it('HTTP 失败也记一条（ok=false + 状态码），并带上回包里的 usage', async () => {
    await assert.rejects(
      () => PageAdvisorLLM.suggest(
        { apiKey: 'sk-abc', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        { url: 'https://p', title: 'Hi', pageText: 'body' },
        {
          hostConfirmed: true,
          fetchImpl: async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ usage: { prompt_tokens: 40, completion_tokens: 0 } }),
          }),
        },
      ),
      /llm http 429/,
    );

    const entries = await Ledger.listCalls();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ok, false);
    assert.equal(entries[0].status, 429);
    assert.equal(entries[0].tokens.input, 40);
  });

  it('网络异常（含超时 abort）记一条 status=0 后原样抛错', async () => {
    await assert.rejects(
      () => PageAdvisorLLM.suggest(
        { apiKey: 'sk-abc', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
        { url: 'https://p', title: 'Hi', pageText: 'body' },
        {
          hostConfirmed: true,
          fetchImpl: async () => { throw new Error('network down'); },
        },
      ),
      /network down/,
    );

    const entries = await Ledger.listCalls();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ok, false);
    assert.equal(entries[0].status, 0);
    assert.equal(entries[0].tokens, null);
  });

  it('账本模块未加载时不打扰调用（老包/裸环境）', async () => {
    delete globalThis.PageAdvisorLLMLedger;
    const items = await PageAdvisorLLM.suggest(
      { apiKey: 'sk-abc', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      {
        hostConfirmed: true,
        fetchImpl: async () => ({ ok: true, status: 200, text: async () => CHAT_OK_BODY }),
      },
    );
    assert.equal(items[0].title, 'Idea');
    assert.equal((await Ledger.listCalls()).length, 0);
  });
});

describe('连通性探针（probe）落账本', () => {
  it('探测成功只记主机与结果，不记 tokens/正文', async () => {
    const state = await Probe.probeLlmConnectivity(
      { apiKey: 'sk-abc', baseUrl: 'https://api.openai.com/v1', model: 'gpt-x' },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        }),
      },
    );
    assert.equal(state.ok, true);

    const entries = await Ledger.listCalls();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'probe');
    assert.equal(entries[0].host, 'api.openai.com');
    assert.equal(entries[0].ok, true);
    assert.equal(entries[0].tokens, null, '探针不记 tokens');
  });

  it('探测失败（连接不上）也留痕：status=0，便于回答「试过哪些主机」', async () => {
    await assert.rejects(
      () => Probe.probeLlmConnectivity(
        { apiKey: 'sk-abc', baseUrl: 'https://api.openai.com/v1', model: 'gpt-x' },
        { fetchImpl: async () => { throw new Error('econnrefused'); } },
      ),
      /econnrefused|network/,
    );

    const entries = await Ledger.listCalls();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].source, 'probe');
    assert.equal(entries[0].ok, false);
    assert.equal(entries[0].status, 0);
  });
});
