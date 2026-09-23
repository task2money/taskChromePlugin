/**
 * 自动创新直连 LLM 配置（纯函数 + chrome.storage 读写）。
 * 密钥只存本机 local，不上传 SaaS。
 */

'use strict';

const PageAdvisorLlmConfig = (() => {
  const STORAGE_KEYS = {
    // Secret-Hardcode-OK: chrome.storage 键名，不是凭据字面量
    apiKey: 'pageAdvisorLlmApiKey',
    baseUrl: 'pageAdvisorLlmBaseUrl',
    model: 'pageAdvisorLlmModel',
    routeMode: 'pageAdvisorLlmRoute',
  };

  function normalizeRouteMode(raw) {
    const v = String(raw || '').trim();
    return v === 'direct' || v === 'saas' ? v : '';
  }

  function normalizeConfig(raw) {
    return {
      apiKey: String(raw?.apiKey || '').trim(),
      baseUrl: String(raw?.baseUrl || '').trim().replace(/\/+$/, ''),
      model: String(raw?.model || '').trim(),
      routeMode: normalizeRouteMode(raw?.routeMode),
    };
  }

  function isDirectLlmReady(cfg) {
    const c = normalizeConfig(cfg);
    return Boolean(c.apiKey && c.baseUrl && c.model);
  }

  /** 未保存过时：Key 齐全走直连，否则走平台后端。显式 direct/saas 覆盖该默认。 */
  function resolveRoute(cfg) {
    const c = normalizeConfig(cfg);
    if (c.routeMode) return c.routeMode;
    return isDirectLlmReady(c) ? 'direct' : 'saas';
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
      STORAGE_KEYS.routeMode,
    ]);
    return normalizeConfig({
      apiKey: raw?.[STORAGE_KEYS.apiKey],
      baseUrl: raw?.[STORAGE_KEYS.baseUrl],
      model: raw?.[STORAGE_KEYS.model],
      routeMode: raw?.[STORAGE_KEYS.routeMode],
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
      [STORAGE_KEYS.routeMode]: c.routeMode,
    });
  }

  return {
    STORAGE_KEYS,
    normalizeConfig,
    normalizeRouteMode,
    isDirectLlmReady,
    resolveRoute,
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
