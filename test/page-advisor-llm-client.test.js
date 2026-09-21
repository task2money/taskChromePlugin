'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorLLM = require('../lib/page-advisor-llm-client.js');
const PageAdvisorLlmConfig = require('../lib/page-advisor-llm-config.js');

describe('PageAdvisorLlmConfig', () => {
  it('isDirectLlmReady requires apiKey, baseUrl, and model', () => {
    assert.equal(PageAdvisorLlmConfig.isDirectLlmReady({}), false);
    assert.equal(PageAdvisorLlmConfig.isDirectLlmReady({ apiKey: 'k', baseUrl: 'https://x' }), false);
    assert.equal(PageAdvisorLlmConfig.isDirectLlmReady({
      apiKey: 'k',
      baseUrl: 'https://api.example.com/',
      model: 'm1',
    }), true);
  });

  it('loadFromStorage maps chrome.storage keys', async () => {
    const mem = {
      pageAdvisorLlmApiKey: 'sk-test',
      pageAdvisorLlmBaseUrl: 'https://api.deepseek.com',
      pageAdvisorLlmModel: 'deepseek-chat',
    };
    const cfg = await PageAdvisorLlmConfig.loadFromStorage({
      get: async (keys) => {
        const out = {};
        for (const k of keys) out[k] = mem[k];
        return out;
      },
    });
    assert.equal(cfg.apiKey, 'sk-test');
    assert.ok(PageAdvisorLlmConfig.isDirectLlmReady(cfg));
  });
});

describe('PageAdvisorLLM URL and JSON', () => {
  it('joinChatCompletionsURL appends /v1/chat/completions', () => {
    assert.equal(
      PageAdvisorLLM.joinChatCompletionsURL('https://api.openai.com'),
      'https://api.openai.com/v1/chat/completions',
    );
    assert.equal(
      PageAdvisorLLM.joinChatCompletionsURL('https://api.deepseek.com/v1'),
      'https://api.deepseek.com/v1/chat/completions',
    );
    assert.equal(
      PageAdvisorLLM.joinChatCompletionsURL('https://x/v1/chat/completions'),
      'https://x/v1/chat/completions',
    );
  });

  it('parseSuggestionsJSON reads array and fenced content', () => {
    const items = PageAdvisorLLM.parseSuggestionsJSON(
      '```json\n[{"id":"s1","title":"T","summary":"S","detail":"D","category":"a11y"}]\n```',
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'T');
  });

  it('extractChatContent then parse', () => {
    const content = PageAdvisorLLM.extractChatContent(JSON.stringify({
      choices: [{ message: { content: '[{"title":"Hello","summary":"x"}]' } }],
    }));
    const items = PageAdvisorLLM.parseSuggestionsJSON(content);
    assert.equal(items[0].title, 'Hello');
  });

  it('suggest POSTs Bearer token and returns parsed items', async () => {
    let seen;
    const items = await PageAdvisorLLM.suggest(
      { apiKey: 'sk-abc', baseUrl: 'https://llm.test/v1', model: 'm' },
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      {
        fetchImpl: async (url, opts) => {
          seen = { url, opts };
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              choices: [{ message: { content: '[{"title":"Idea","summary":"ok"}]' } }],
            }),
          };
        },
      },
    );
    assert.equal(seen.url, 'https://llm.test/v1/chat/completions');
    assert.equal(seen.opts.headers.Authorization, 'Bearer sk-abc');
    assert.equal(items[0].title, 'Idea');
    assert.doesNotMatch(JSON.stringify(seen.opts.body), /sk-abc/);
  });
});
