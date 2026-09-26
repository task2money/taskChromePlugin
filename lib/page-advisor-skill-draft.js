/**
 * 提示词 Skill 编辑区的本机草稿（OPT-20260926-010）。
 *
 * 工具栏 Popup 失焦即卸载：用户常要在编辑 Skill 的同时去别处复制提示词，
 * 回来时标题/倾向/正文仍是空的。这里把未保存的编辑内容单独落本机，
 * 与直连 Key 的 pageAdvisorLlmDraft 分开存放 —— 未确认的正文绝不写进
 * 已保存（并可能已同步到云端）的 Skill 记录。
 */

'use strict';

const PageAdvisorSkillDraft = (() => {
  const DRAFT_KEY = 'pageAdvisorSkillDraft'; // Secret-Hardcode-OK: chrome.storage 键名，不是凭据
  const MAX_TITLE = 80;
  const MAX_TENDENCY = 32;
  const MAX_BODY = 8000;

  function storageOf(storageApi) {
    if (storageApi) return storageApi;
    if (typeof Storage !== 'undefined' && Storage && typeof Storage.get === 'function') return Storage;
    return null;
  }

  /**
   * 规范化草稿；没有任何标题/正文时返回 null（空表单不留草稿）。
   * @param {unknown} raw
   * @returns {{skillId: string, title: string, tendency: string, body: string}|null}
   */
  function parseDraft(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const draft = {
      skillId: String(raw.skillId || ''),
      title: String(raw.title ?? '').slice(0, MAX_TITLE),
      tendency: String(raw.tendency ?? '').slice(0, MAX_TENDENCY),
      body: String(raw.body ?? '').slice(0, MAX_BODY),
    };
    if (!draft.title.trim() && !draft.body.trim()) return null;
    return draft;
  }

  /**
   * 草稿只回填到它所属的编辑目标：编辑 A 时不要串到 B，也不要把老草稿
   * 灌进「新建」（skillId 为空串）。
   * @param {unknown} draft
   * @param {string} skillId 当前编辑的 Skill id（新建时为空串）
   * @returns {boolean}
   */
  function shouldRestoreDraft(draft, skillId) {
    const parsed = parseDraft(draft);
    if (!parsed) return false;
    return parsed.skillId === String(skillId || '');
  }

  async function loadDraftFromStorage(storageApi) {
    const store = storageOf(storageApi);
    if (!store || typeof store.get !== 'function') return null;
    try {
      const raw = await store.get([DRAFT_KEY]);
      return parseDraft(raw && raw[DRAFT_KEY]);
    } catch (_) {
      return null;
    }
  }

  async function clearDraftFromStorage(storageApi) {
    const store = storageOf(storageApi);
    if (!store) return false;
    try {
      if (typeof store.remove === 'function') {
        await store.remove([DRAFT_KEY]);
        return true;
      }
      if (typeof store.set === 'function') {
        await store.set({ [DRAFT_KEY]: null });
        return true;
      }
    } catch (_) {
      /* 配额/隐私模式：清理失败不阻断编辑 */
    }
    return false;
  }

  async function saveDraftToStorage(draft, storageApi) {
    const store = storageOf(storageApi);
    if (!store || typeof store.set !== 'function') return null;
    const parsed = parseDraft(draft);
    if (!parsed) {
      await clearDraftFromStorage(store);
      return null;
    }
    try {
      await store.set({ [DRAFT_KEY]: parsed });
    } catch (_) {
      return null;
    }
    return parsed;
  }

  return {
    DRAFT_KEY,
    parseDraft,
    shouldRestoreDraft,
    loadDraftFromStorage,
    saveDraftToStorage,
    clearDraftFromStorage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorSkillDraft;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorSkillDraft = PageAdvisorSkillDraft;
}
