/**
 * 旧版本地存储清理（Task 15 / ADR-0169 后续）。
 *
 * 直连 Key、浏览器内置生成、本地提示词 Skill 三条链已下线，它们写在
 * chrome.storage.local 的配置与草稿不再有任何读取方。这里在扩展安装/更新
 * 与 Service Worker 启动时幂等清掉，避免旧 Key 长期留在本机。
 *
 * 只删固定名单；`pageAdvisorSelectedPromptId`（服务端提示词选中项）不属于旧链，绝不触碰。
 */

'use strict';

const PageAdvisorLegacyCleanup = (() => {
  // Secret-Hardcode-OK: chrome.storage 键名清单，不是凭据
  const LEGACY_KEYS = Object.freeze([
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
  ]);

  /**
   * 幂等清理：键不存在时 `remove` 也是空操作。
   * 清理属于尽力而为，任何失败只告警，绝不阻塞扩展启动。
   * @returns {Promise<void>}
   */
  async function cleanupLegacyStorage() {
    try {
      const area = globalThis.chrome?.storage?.local;
      if (!area || typeof area.remove !== 'function') return;
      await area.remove([...LEGACY_KEYS]);
    } catch (e) {
      console.warn('[taskChromePlugin] legacy storage cleanup:', e?.message || e);
    }
  }

  return {
    STORAGE_KEYS: LEGACY_KEYS,
    LEGACY_KEYS,
    cleanupLegacyStorage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLegacyCleanup;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLegacyCleanup = PageAdvisorLegacyCleanup;
}
