'use strict';

/**
 * Task 15：直连 Key / 浏览器内置生成 / 本地提示词 Skill 三链下线后，
 * 旧 chrome.storage.local 键必须被幂等清理，且不得误删新的「选中服务端提示词」键。
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const LegacyCleanup = require('../lib/page-advisor-legacy-cleanup.js');

const LEGACY_KEYS = [
  'pageAdvisorPromptSkills',
  'pageAdvisorActiveSkillId',
  'pageAdvisorCategoryChoices',
  'pageAdvisorSkillDraft',
  'pageAdvisorLlmApiKey',
  'pageAdvisorLlmBaseUrl',
  'pageAdvisorLlmModel',
  'pageAdvisorLlmRoute',
  'pageAdvisorLlmSystemSkuId',
  'pageAdvisorLlmOwnProvider',
  'pageAdvisorLlmOwnModel',
  'pageAdvisorLlmProfiles',
  'pageAdvisorLlmActiveProfileId',
  'pageAdvisorLlmDraft',
  'pageAdvisorLlmConfirmedHosts',
  'llmCallLedger',
];

function installChrome(seed) {
  const store = { ...seed };
  const removed = [];
  globalThis.chrome = {
    storage: {
      local: {
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          removed.push(...list);
          for (const key of list) delete store[key];
        },
      },
    },
  };
  return { store, removed };
}

describe('PageAdvisorLegacyCleanup', () => {
  beforeEach(() => {
    delete globalThis.chrome;
  });

  afterEach(() => {
    delete globalThis.chrome;
  });

  it('removes every legacy key including API keys and keeps pageAdvisorSelectedPromptId', async () => {
    assert.deepEqual(Array.from(LegacyCleanup.LEGACY_KEYS), LEGACY_KEYS);
    const seed = {
      pageAdvisorSelectedPromptId: 'sys-seo',
      pluginConfig: { baseUrl: 'https://api.example.test' },
    };
    for (const key of LEGACY_KEYS) seed[key] = `legacy:${key}`;
    seed.pageAdvisorLlmApiKey = 'sk-legacy-should-be-removed';
    const { store } = installChrome(seed);

    await LegacyCleanup.cleanupLegacyStorage();

    for (const key of LEGACY_KEYS) {
      assert.equal(key in store, false, `旧键未清理：${key}`);
    }
    assert.equal(store.pageAdvisorSelectedPromptId, 'sys-seo');
    assert.deepEqual(store.pluginConfig, { baseUrl: 'https://api.example.test' });
  });

  it('runs twice without error and leaves the new key untouched', async () => {
    const seed = { pageAdvisorSelectedPromptId: 'ws-conv' };
    for (const key of LEGACY_KEYS) seed[key] = true;
    const { store } = installChrome(seed);

    await LegacyCleanup.cleanupLegacyStorage();
    await LegacyCleanup.cleanupLegacyStorage();

    assert.equal(store.pageAdvisorSelectedPromptId, 'ws-conv');
    for (const key of LEGACY_KEYS) assert.equal(key in store, false);
  });
});
