'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const PageAdvisorLlmConfig = require('../lib/page-advisor-llm-config.js');

function memStore(initial) {
  const mem = { ...initial };
  return {
    mem,
    async get(keys) {
      const out = {};
      for (const k of keys) out[k] = mem[k];
      return out;
    },
    async set(patch) {
      Object.assign(mem, patch);
    },
    async remove(keys) {
      for (const k of keys) delete mem[k];
    },
  };
}

describe('PageAdvisorLlmConfig draft', () => {
  it('a pasted draft stays in storage and does not replace the active key', async () => {
    const store = memStore({
      pageAdvisorLlmApiKey: 'sk-live-aaaa',
      pageAdvisorLlmBaseUrl: 'https://live.example/v1',
      pageAdvisorLlmModel: 'live-model',
      pageAdvisorLlmActiveProfileId: 'legacy',
      pageAdvisorLlmProfiles: [{
        id: 'legacy',
        label: '当前',
        apiKey: 'sk-live-aaaa',
        baseUrl: 'https://live.example/v1',
        model: 'live-model',
      }],
    });
    const saved = await PageAdvisorLlmConfig.saveDraftToStorage({
      profileId: '',
      label: '备用',
      apiKey: 'sk-pasted-bbbb',
      baseUrl: '',
      model: '',
    }, store);
    assert.equal(saved.apiKey, 'sk-pasted-bbbb');
    assert.equal(saved.baseUrl, '');
    assert.equal(store.mem.pageAdvisorLlmApiKey, 'sk-live-aaaa');
    assert.equal(store.mem.pageAdvisorLlmDraft.apiKey, 'sk-pasted-bbbb');

    const loaded = await PageAdvisorLlmConfig.loadDraftFromStorage(store);
    assert.equal(loaded.apiKey, 'sk-pasted-bbbb');
    assert.equal(loaded.label, '备用');
    const active = await PageAdvisorLlmConfig.loadFromStorage(store);
    assert.equal(active.apiKey, 'sk-live-aaaa');
    assert.equal(PageAdvisorLlmConfig.shouldRestoreDraft(loaded, active), true);
    assert.equal(PageAdvisorLlmConfig.shouldRestoreDraft({
      profileId: 'legacy',
      label: '当前',
      apiKey: 'sk-live-aaaa',
      baseUrl: 'https://live.example/v1',
      model: 'live-model',
    }, active), false);

    await PageAdvisorLlmConfig.clearDraftFromStorage(store);
    assert.equal(store.mem.pageAdvisorLlmDraft, undefined);
    assert.equal(await PageAdvisorLlmConfig.loadDraftFromStorage(store), null);
  });
});
