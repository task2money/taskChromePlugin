'use strict';

/**
 * OPT-20261007-015：直连 Base URL 主机不是常见主机时，首次发送前必须确认。
 * 关键判据：未确认前不得调用 fetch（页面正文不能先离开本机再问）。
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorLLM = require('../lib/page-advisor-llm-client.js');
const PageAdvisorLlmConfig = require('../lib/page-advisor-llm-config.js');

const {
  hostOf,
  isLoopbackHost,
  hostNeedsConfirmation,
  hostConfirmRequiredError,
} = PageAdvisorLLM;

describe('hostOf', () => {
  it('extracts a lowercase hostname from a base URL', () => {
    assert.equal(hostOf('https://API.Example.com/v1'), 'api.example.com');
    assert.equal(hostOf('api.example.com'), 'api.example.com');
    assert.equal(hostOf('http://127.0.0.1:8080/v1'), '127.0.0.1');
    assert.equal(hostOf(''), '');
    assert.equal(hostOf('not a url'), '');
  });
});

describe('hostNeedsConfirmation', () => {
  it('trusts common model hosts and loopback', () => {
    assert.equal(hostNeedsConfirmation('https://api.deepseek.com'), false);
    assert.equal(hostNeedsConfirmation('https://api.openai.com/v1'), false);
    assert.equal(hostNeedsConfirmation('https://localhost:8080'), false);
    assert.equal(hostNeedsConfirmation('http://127.0.0.1:1234'), false);
  });

  it('trusts the current site host and its subdomains', () => {
    assert.equal(hostNeedsConfirmation('https://www.aidevpush.com/v1', { siteHost: 'www.aidevpush.com' }), false);
    assert.equal(hostNeedsConfirmation('https://api.aidevpush.com/v1', { siteHost: 'aidevpush.com' }), false);
    assert.equal(hostNeedsConfirmation('https://evil-aidevpush.com/v1', { siteHost: 'aidevpush.com' }), true);
  });

  it('flags everything else', () => {
    assert.equal(hostNeedsConfirmation('https://random-proxy.example/v1'), true);
    assert.equal(hostNeedsConfirmation('https://164.90.1.2/v1'), true);
  });

  it('is not loopback for a lookalike', () => {
    assert.equal(isLoopbackHost('localhost'), true);
    assert.equal(isLoopbackHost('localhost.evil.com'), false);
    assert.equal(hostNeedsConfirmation('https://localhost.evil.com/v1'), true);
  });
});

describe('suggest host gate', () => {
  const creds = { apiKey: 'sk-test', baseUrl: 'https://random-proxy.example', model: 'm1' };
  const page = { url: 'https://site.test/', title: 't', pageText: 'secret page text', domOutline: [] };

  it('throws HOST_CONFIRM_REQUIRED before fetching when host is uncommon', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error('must not be called'); };
    await assert.rejects(
      () => PageAdvisorLLM.suggest(creds, page, { fetchImpl }),
      (err) => {
        assert.equal(err.code, 'HOST_CONFIRM_REQUIRED');
        assert.equal(err.host, 'random-proxy.example');
        return true;
      },
    );
    assert.equal(calls, 0, '确认前不得调用 fetch');
  });

  it('proceeds once the host is persisted as confirmed', async () => {
    const mem = { pageAdvisorLlmConfirmedHosts: ['random-proxy.example'] };
    const prevStorage = globalThis.Storage;
    globalThis.Storage = {
      get: async (keys) => {
        const out = {};
        for (const k of keys) out[k] = mem[k];
        return out;
      },
      set: async (obj) => { Object.assign(mem, obj); },
    };
    try {
      let calls = 0;
      const fetchImpl = async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
        };
      };
      await PageAdvisorLLM.suggest(creds, page, { fetchImpl });
      assert.equal(calls, 1, '已确认主机应放行');
    } finally {
      if (prevStorage === undefined) delete globalThis.Storage;
      else globalThis.Storage = prevStorage;
    }
  });

  it('proceeds once the host is confirmed for this run', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { content: '[{"id":"s1","title":"t"}]' } }] }),
      };
    };
    const out = await PageAdvisorLLM.suggest(creds, page, { fetchImpl, hostConfirmed: true });
    assert.equal(calls, 1);
    assert.equal(out.length, 1);
  });

  it('does not gate common hosts or the current site host', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
    });
    let calls = 0;
    const counting = async (...a) => { calls += 1; return fetchImpl(...a); };
    await PageAdvisorLLM.suggest(
      { ...creds, baseUrl: 'https://api.deepseek.com' }, page, { fetchImpl: counting },
    );
    await PageAdvisorLLM.suggest(
      { ...creds, baseUrl: 'https://api.aidevpush.com/v1' }, page,
      { fetchImpl: counting, siteHost: 'aidevpush.com' },
    );
    assert.equal(calls, 2);
  });
});

describe('confirmed host persistence', () => {
  function memStorage(initial) {
    const mem = { ...(initial || {}) };
    return {
      mem,
      get: async (keys) => {
        const out = {};
        for (const k of keys) out[k] = mem[k];
        return out;
      },
      set: async (obj) => { Object.assign(mem, obj); },
    };
  }

  it('normalizes and dedups the confirmed host list', () => {
    assert.deepEqual(PageAdvisorLlmConfig.normalizeConfirmedHosts([' A.com', 'a.com', '', 'b.com']), ['a.com', 'b.com']);
    assert.deepEqual(PageAdvisorLlmConfig.normalizeConfirmedHosts('["x.com"]'), ['x.com']);
    assert.deepEqual(PageAdvisorLlmConfig.normalizeConfirmedHosts(null), []);
  });

  it('confirmHost persists and isHostConfirmed reads it back', async () => {
    const store = memStorage();
    assert.equal(PageAdvisorLlmConfig.isHostConfirmed('a.com', await PageAdvisorLlmConfig.loadConfirmedHosts(store)), false);
    await PageAdvisorLlmConfig.confirmHost('A.com', store);
    const list = await PageAdvisorLlmConfig.loadConfirmedHosts(store);
    assert.equal(PageAdvisorLlmConfig.isHostConfirmed('a.com', list), true);
  });
});

describe('hostConfirmRequiredError', () => {
  it('carries code and host', () => {
    const err = hostConfirmRequiredError('x.example');
    assert.equal(err.code, 'HOST_CONFIRM_REQUIRED');
    assert.equal(err.host, 'x.example');
  });
});
