'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  };
}

describe('PageAdvisorLlmConfig profiles', () => {
  it('loads a legacy single key as one local profile', async () => {
    const store = memStore({
      pageAdvisorLlmApiKey: 'sk-test',
      pageAdvisorLlmBaseUrl: 'https://api.deepseek.com',
      pageAdvisorLlmModel: 'deepseek-chat',
    });
    const cfg = await PageAdvisorLlmConfig.loadFromStorage(store);
    assert.equal(cfg.apiKey, 'sk-test');
    assert.equal(cfg.profiles.length, 1);
    assert.equal(cfg.activeProfileId, 'legacy');
    assert.equal(store.mem.pageAdvisorLlmActiveProfileId, 'legacy');
    assert.equal(store.mem.pageAdvisorLlmProfiles.length, 1);
  });

  it('saves a second profile and switches the active key from the dropdown id', async () => {
    const store = memStore({});
    const first = await PageAdvisorLlmConfig.saveToStorage({
      apiKey: 'sk-first-aaaa',
      baseUrl: 'https://a.example/v1',
      model: 'model-a',
      routeMode: 'direct',
      profileAction: 'create',
      profileLabel: '工作',
    }, store);
    const second = await PageAdvisorLlmConfig.saveToStorage({
      apiKey: 'sk-second-bbbb',
      baseUrl: 'https://b.example/v1',
      model: 'model-b',
      routeMode: 'direct',
      profileAction: 'create',
      profileLabel: '备用',
    }, store);
    assert.equal(second.profiles.length, 2);
    assert.equal(second.apiKey, 'sk-second-bbbb');
    assert.notEqual(first.activeProfileId, second.activeProfileId);

    const switched = await PageAdvisorLlmConfig.activateProfile(first.activeProfileId, store);
    assert.equal(switched.apiKey, 'sk-first-aaaa');
    assert.equal(switched.baseUrl, 'https://a.example/v1');
    assert.equal(switched.model, 'model-a');
    assert.equal(switched.activeProfileId, first.activeProfileId);
    assert.equal(store.mem.pageAdvisorLlmApiKey, 'sk-first-aaaa');

    const loaded = await PageAdvisorLlmConfig.loadFromStorage(store);
    assert.equal(loaded.apiKey, 'sk-first-aaaa');
    assert.equal(loaded.profiles.length, 2);
  });

  it('route-only save does not replace the active key with an empty form', async () => {
    const store = memStore({});
    await PageAdvisorLlmConfig.saveToStorage({
      apiKey: 'sk-keep-cccc',
      baseUrl: 'https://keep.example/v1',
      model: 'keep-model',
      routeMode: 'direct',
      profileAction: 'create',
      profileLabel: '保留',
    }, store);
    const next = await PageAdvisorLlmConfig.saveToStorage({
      apiKey: '',
      baseUrl: '',
      model: '',
      routeMode: 'saas',
      profileAction: 'route-only',
    }, store);
    assert.equal(next.apiKey, 'sk-keep-cccc');
    assert.equal(next.routeMode, 'saas');
    assert.equal(PageAdvisorLlmConfig.resolveRoute(next), 'saas');
  });

  it('dropdown label redacts the full API key and keeps a short tail', () => {
    const key = 'sk-live-secret-value-wxyz';
    const text = PageAdvisorLlmConfig.profileOptionLabel({
      label: key,
      model: 'deepseek-chat',
      apiKey: key,
    });
    assert.equal(text.includes(key), false);
    assert.match(text, /wxyz/);
    assert.doesNotMatch(text, /secret-value/);
  });

  it('rejects a 21st profile and delete falls back to the remaining one', () => {
    const profiles = [];
    for (let i = 0; i < PageAdvisorLlmConfig.MAX_PROFILES; i += 1) {
      profiles.push({
        id: `p${i}`,
        label: `n${i}`,
        apiKey: `sk-key-${i}-tail`,
        baseUrl: 'https://x.example',
        model: 'm',
      });
    }
    assert.throws(
      () => PageAdvisorLlmConfig.applyProfileMutation({
        profiles,
        activeProfileId: 'p0',
        routeMode: 'direct',
      }, {
        profileAction: 'create',
        profileLabel: 'overflow',
        apiKey: 'sk-overflow-zzzz',
        baseUrl: 'https://z.example',
        model: 'mz',
        routeMode: 'direct',
      }),
      (err) => err && err.code === 'profile_limit',
    );

    const left = PageAdvisorLlmConfig.applyProfileMutation({
      profiles,
      activeProfileId: 'p0',
      routeMode: 'direct',
    }, { profileAction: 'delete', profileId: 'p0', routeMode: 'direct' });
    assert.equal(left.profiles.length, PageAdvisorLlmConfig.MAX_PROFILES - 1);
    assert.notEqual(left.activeProfileId, 'p0');
    assert.equal(left.apiKey, left.profiles[0].apiKey);
  });

  it('popup shows the profile dropdown outside the collapsed settings fields', () => {
    const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
    const llm = html.match(/id="pageAdvisorLlmSection"[\s\S]*?<\/section>/)[0];
    const selectAt = llm.indexOf('id="popupLlmProfileSelect"');
    const fieldsAt = llm.indexOf('id="pageAdvisorLlmFields"');
    assert.ok(selectAt >= 0 && selectAt < fieldsAt, '下拉菜单应在折叠设置区之外');
    const fields = llm.slice(fieldsAt);
    assert.match(fields, /id="popupLlmProfileName"/);
    assert.match(fields, /id="btnDeleteLlmProfile"/);
    assert.match(llm, /data-i18n="paLlmProfileLabel"/);
  });
});
