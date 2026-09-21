/**
 * 自动创新直连 LLM 配置（纯函数 + chrome.storage 读写）。
 * 密钥只存本机 local，不上传 SaaS。
 */

'use strict';

const PageAdvisorLlmConfig = (() => {
  const STORAGE_KEYS = {
    apiKey: 'pageAdvisorLlmApiKey',
    baseUrl: 'pageAdvisorLlmBaseUrl',
    model: 'pageAdvisorLlmModel',
  };

  function normalizeConfig(raw) {
    return {
      apiKey: String(raw?.apiKey || '').trim(),
      baseUrl: String(raw?.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(raw?.model || '').trim(),
    };
  }

  function isDirectLlmReady(cfg) {
    const c = normalizeConfig(cfg);
    return Boolean(c.apiKey && c.baseUrl && c.model);
  }

  async function loadFromStorage(storageApi) {
    const store = storageApi || (typeof Storage !== 'undefined' ? Storage : null);
    if (!store || typeof store.get !== 'function') {
      return normalizeConfig({});
    }
    const raw = await store.get([
      STORAGE_KEYS.apiKey,
      STORAGE_KEYS.baseUrl,
      STORAGE_KEYS.model,
    ]);
    return normalizeConfig({
      apiKey: raw?.[STORAGE_KEYS.apiKey],
      baseUrl: raw?.[STORAGE_KEYS.baseUrl],
      model: raw?.[STORAGE_KEYS.model],
    });
  }

  async function saveToStorage(cfg, storageApi) {
    const store = storageApi || (typeof Storage !== 'undefined' ? Storage : null);
    if (!store || typeof store.set !== 'function') {
      throw new Error('storage unavailable');
    }
    const c = normalizeConfig(cfg);
    return store.set({
      [STORAGE_KEYS.apiKey]: c.apiKey,
      [STORAGE_KEYS.baseUrl]: c.baseUrl,
      [STORAGE_KEYS.model]: c.model,
    });
  }

  return {
    STORAGE_KEYS,
    normalizeConfig,
    isDirectLlmReady,
    loadFromStorage,
    saveToStorage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLlmConfig;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLlmConfig = PageAdvisorLlmConfig;
}
