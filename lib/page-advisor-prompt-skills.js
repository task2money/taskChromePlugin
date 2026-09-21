/**
 * 本机自动创新倾向 Skill（纯函数 + chrome.storage）。
 * 不上传 SaaS；仅直连 LLM 拼接 system。
 */

'use strict';

const PageAdvisorPromptSkills = (() => {
  const STORAGE_KEYS = {
    // Secret-Hardcode-OK: chrome.storage 键名，不是凭据
    list: 'pageAdvisorPromptSkills',
    activeId: 'pageAdvisorActiveSkillId',
  };
  const MAX_SKILLS = 20;
  const MAX_BODY = 8000;
  const MAX_TITLE = 80;
  const TENDENCIES = ['a11y', 'conversion', 'perf', 'seo', 'custom'];

  function emptyStore() {
    return { skills: [], activeSkillId: '' };
  }

  function normalizeTendency(raw) {
    const t = String(raw || '').trim();
    return TENDENCIES.includes(t) ? t : 'custom';
  }

  function normalizeSkill(raw, now = Date.now()) {
    const id = String(raw?.id || '').trim();
    return {
      id,
      title: String(raw?.title || '').trim(),
      tendency: normalizeTendency(raw?.tendency),
      body: String(raw?.body || ''),
      updatedAt: Number(raw?.updatedAt) || now,
    };
  }

  function parseList(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function normalizeStore(raw) {
    const skills = parseList(raw?.skills).map((s) => normalizeSkill(s));
    let activeSkillId = String(raw?.activeSkillId || '').trim();
    if (activeSkillId && !skills.some((s) => s.id === activeSkillId)) {
      activeSkillId = '';
    }
    return { skills, activeSkillId };
  }

  function newSkillId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `ps_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function upsertSkill(store, patch, now = Date.now()) {
    const st = normalizeStore(store);
    const incoming = normalizeSkill(patch, now);
    if (!incoming.title) {
      throw new Error('skill title required');
    }
    if (incoming.title.length > MAX_TITLE) {
      throw new Error(`skill title max ${MAX_TITLE}`);
    }
    if (incoming.body.length > MAX_BODY) {
      throw new Error(`skill body max ${MAX_BODY}`);
    }
    const id = incoming.id || newSkillId();
    const idx = st.skills.findIndex((s) => s.id === id);
    const next = { ...incoming, id, updatedAt: now };
    if (idx < 0) {
      if (st.skills.length >= MAX_SKILLS) {
        throw new Error(`skill count max ${MAX_SKILLS}`);
      }
      st.skills = st.skills.concat(next);
    } else {
      st.skills = st.skills.slice();
      st.skills[idx] = next;
    }
    return { store: st, skill: next };
  }

  function removeSkill(store, skillId) {
    const st = normalizeStore(store);
    const id = String(skillId || '').trim();
    st.skills = st.skills.filter((s) => s.id !== id);
    if (st.activeSkillId === id) st.activeSkillId = '';
    return { store: st };
  }

  function setActive(store, skillId) {
    const st = normalizeStore(store);
    const id = String(skillId || '').trim();
    if (id && !st.skills.some((s) => s.id === id)) {
      throw new Error('skill not found');
    }
    st.activeSkillId = id;
    return { store: st };
  }

  function getActive(store) {
    const st = normalizeStore(store);
    if (!st.activeSkillId) return null;
    return st.skills.find((s) => s.id === st.activeSkillId) || null;
  }

  function buildSkillSystemContent(skill) {
    if (!skill) return '';
    const title = String(skill.title || '').trim() || 'untitled';
    const body = String(skill.body || '');
    return `## User skill: ${title}\n${body}`;
  }

  async function loadFromStorage(storageApi) {
    const store = storageApi || (typeof Storage !== 'undefined' ? Storage : null);
    if (!store || typeof store.get !== 'function') {
      return emptyStore();
    }
    const raw = await store.get([STORAGE_KEYS.list, STORAGE_KEYS.activeId]);
    return normalizeStore({
      skills: raw?.[STORAGE_KEYS.list],
      activeSkillId: raw?.[STORAGE_KEYS.activeId],
    });
  }

  async function saveToStorage(storeObj, storageApi) {
    const api = storageApi || (typeof Storage !== 'undefined' ? Storage : null);
    if (!api || typeof api.set !== 'function') {
      throw new Error('storage unavailable');
    }
    const st = normalizeStore(storeObj);
    return api.set({
      [STORAGE_KEYS.list]: st.skills,
      [STORAGE_KEYS.activeId]: st.activeSkillId,
    });
  }

  return {
    STORAGE_KEYS,
    MAX_SKILLS,
    MAX_BODY,
    MAX_TITLE,
    TENDENCIES,
    emptyStore,
    normalizeStore,
    normalizeSkill,
    newSkillId,
    upsertSkill,
    removeSkill,
    setActive,
    getActive,
    buildSkillSystemContent,
    loadFromStorage,
    saveToStorage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPromptSkills;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPromptSkills = PageAdvisorPromptSkills;
}
