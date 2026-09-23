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

  it('resolveRoute follows an explicit choice and otherwise the key', () => {
    const ready = { apiKey: 'k', baseUrl: 'https://x', model: 'm' };
    assert.equal(PageAdvisorLlmConfig.resolveRoute(ready), 'direct');
    assert.equal(PageAdvisorLlmConfig.resolveRoute({}), 'saas');
    assert.equal(PageAdvisorLlmConfig.resolveRoute({ ...ready, routeMode: 'saas' }), 'saas');
    assert.equal(PageAdvisorLlmConfig.resolveRoute({ routeMode: 'direct' }), 'direct');
  });

  it('save and load round-trip routeMode', async () => {
    const mem = {};
    const store = {
      get: async (keys) => {
        const out = {};
        for (const k of keys) out[k] = mem[k];
        return out;
      },
      set: async (patch) => Object.assign(mem, patch),
    };
    await PageAdvisorLlmConfig.saveToStorage({
      apiKey: 'sk',
      baseUrl: 'https://llm.test',
      model: 'm1',
      routeMode: 'saas',
    }, store);
    const cfg = await PageAdvisorLlmConfig.loadFromStorage(store);
    assert.equal(cfg.routeMode, 'saas');
    assert.equal(PageAdvisorLlmConfig.resolveRoute(cfg), 'saas');
    assert.equal(PageAdvisorLlmConfig.isDirectLlmReady(cfg), true);
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

  it('parseSuggestionsJSON repairs missing comma between object fields (V8 Expected "," or "}")', () => {
    const raw = '[{"id":"s1","title":"A" "summary":"s","detail":"d","category":"ux"}]';
    assert.throws(
      () => JSON.parse(raw),
      (err) => /Expected ',' or '}' after property value/.test(String(err && err.message)),
    );
    const items = PageAdvisorLLM.parseSuggestionsJSON(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'A');
    assert.equal(items[0].summary, 's');
  });

  it('parseSuggestionsJSON drops stray false after a completed value', () => {
    const raw = '[{"id":"s1","title":"A","summary":"s","detail":"d","category":"ux","target_nid":"n1","preview":{"ops":[{"op":"setText","nid":"n1","value":"X"}]}false}]';
    const items = PageAdvisorLLM.parseSuggestionsJSON(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'A');
    assert.equal(items[0].preview.ops.length, 1);
  });

  it('parseSuggestionsJSON prefers the suggestions array when prose has an object first', () => {
    const raw = 'Seen {"nid":"n1"} from outline.\n[{"id":"s1","title":"A","summary":"s","detail":"d","category":"ux"}]';
    const items = PageAdvisorLLM.parseSuggestionsJSON(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'A');
  });

  it('parseSuggestionsJSON keeps trailing prose after a fenced array', () => {
    const raw = '```json\n[{"id":"s1","title":"A","summary":"s","detail":"d","category":"ux"}]\n```\nfor operators: ignore';
    const items = PageAdvisorLLM.parseSuggestionsJSON(raw);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'A');
  });

  it('parseSuggestionsJSON reads wrapped {suggestions:[]}', () => {
    const items = PageAdvisorLLM.parseSuggestionsJSON(
      '{"suggestions":[{"title":"B","summary":"s","detail":"d","category":"perf"}]}',
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 's1');
    assert.equal(items[0].title, 'B');
  });

  it('repairLLMJSON drops stray false after completed object value', () => {
    const out = PageAdvisorLLM.repairLLMJSON('{"preview":{"ops":[]}false}');
    assert.equal(out, '{"preview":{"ops":[]}}');
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

  it('suggest appends locale=en system instruction', async () => {
    let body;
    await PageAdvisorLLM.suggest(
      { apiKey: 'sk-abc', baseUrl: 'https://llm.test/v1', model: 'm' },
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      {
        locale: 'en',
        fetchImpl: async (_url, opts) => {
          body = JSON.parse(opts.body);
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
    const sys = (body.messages || []).filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    assert.match(sys, /locale=en/);
    assert.match(sys, /title, summary, and detail in English/);
  });

  it('suggest logs truncated snippet without api key when JSON parse still fails', async () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...args) => { warns.push(args); };
    try {
      await assert.rejects(
        () => PageAdvisorLLM.suggest(
          { apiKey: 'sk-secret-key', baseUrl: 'https://llm.test/v1', model: 'm' },
          { url: 'https://p', title: 'Hi', pageText: 'body' },
          {
            fetchImpl: async () => ({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({
                choices: [{ message: { content: 'not-json sk-secret-key leftover' } }],
              }),
            }),
          },
        ),
        /parse suggestions json/,
      );
    } finally {
      console.warn = orig;
    }
    const rec = warns.find((a) => a[0] === '[taskChromePlugin] page_advisor_llm_json_parse_failed');
    assert.ok(rec, 'expected parse-failed warn');
    assert.equal(rec[1].model, 'm');
    assert.doesNotMatch(JSON.stringify(rec[1]), /sk-secret-key/);
    assert.match(rec[1].content_snippet, /\[redacted-api-key\]/);
  });
});

// OPT-20260922-038: locale=en 时系统提示整段英文化，避免模型混用中文。
describe('PageAdvisorLLM locale system prompt', () => {
  it('buildChatMessages swaps in the English system prompt for locale=en', () => {
    const msgs = PageAdvisorLLM.buildChatMessages(
      { url: 'https://p', title: 'Hi', pageText: 'body' },
      null,
      'en',
    );
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[0].content.includes('你是网页体验'), false);
    assert.match(msgs[0].content, /web experience and accessibility/);
    assert.match(msgs.at(-1).content, /页面 URL/);
  });

  it('buildChatMessages keeps the built-in Chinese prompt for zh/default', () => {
    const zh = PageAdvisorLLM.buildChatMessages({ url: 'https://p', title: 'Hi' }, null, 'zh-CN');
    assert.equal(zh[0].content, PageAdvisorLLM.SYSTEM_PROMPT);
    const def = PageAdvisorLLM.buildChatMessages({ url: 'https://p', title: 'Hi' }, null, undefined);
    assert.equal(def[0].content, PageAdvisorLLM.SYSTEM_PROMPT);
  });

  it('buildChatMessages reads page.locale when locale arg is absent', () => {
    const msgs = PageAdvisorLLM.buildChatMessages(
      { url: 'https://p', title: 'Hi', locale: 'en-US' },
      null,
      undefined,
    );
    assert.equal(msgs[0].content.includes('你是网页体验'), false);
  });
});
