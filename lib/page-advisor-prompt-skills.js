/**
 * 自动创新倾向 Skill（chrome.storage；登录后与工作空间 prompt-skills 同步）。
 */

'use strict';

if (typeof require === 'function' && typeof globalThis !== 'undefined' && !globalThis.PageAdvisorPresetSkills) {
  require('./page-advisor-preset-skills.js');
}

const PageAdvisorPromptSkills = (() => {
  const STORAGE_KEYS = {
    // Secret-Hardcode-OK: chrome.storage 键名，不是凭据
    list: 'pageAdvisorPromptSkills',
    activeId: 'pageAdvisorActiveSkillId',
  };
  const MAX_SKILLS = 20;
  const MAX_BODY = 8000;
  const MAX_TITLE = 80;
  const MAX_TENDENCY = 32;
  const TENDENCIES = ['a11y', 'conversion', 'perf', 'seo', 'custom'];
  const SYNC_LOCAL = 'local';

  function emptyStore() {
    return { skills: [], activeSkillId: '', categoryChoices: [] };
  }

  function normalizeSyncTarget(raw) {
    return String(raw || '').trim();
  }

  /**
   * 空 syncTarget = 尚未选目标，同步时跟当前默认工作空间（兼容旧缓存）。
   * `local` 只存本机；其它非空值为 workspace_id。
   */
  function skillTargetsWorkspace(skill, workspaceId, legacyWorkspaceId) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return false;
    const t = normalizeSyncTarget(skill?.syncTarget);
    if (t === SYNC_LOCAL) return false;
    if (t) return t === wid;
    return wid === String(legacyWorkspaceId || '').trim();
  }

  function normalizeTendency(raw) {
    const t = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!t) return 'custom';
    const chars = Array.from(t);
    return chars.length > MAX_TENDENCY ? chars.slice(0, MAX_TENDENCY).join('') : t;
  }

  function normalizeSkill(raw, now = Date.now()) {
    const id = String(raw?.id || '').trim();
    return {
      id,
      title: String(raw?.title || '').trim(),
      tendency: normalizeTendency(raw?.tendency),
      body: String(raw?.body || ''),
      updatedAt: Number(raw?.updatedAt) || now,
      syncTarget: normalizeSyncTarget(raw?.syncTarget),
      readonly: Boolean(raw?.readonly),
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

  function persistSkillsOf(storeObj) {
    return parseList(storeObj?.skills).filter((s) => !isSystemPromptSkill(s));
  }

  function normalizeCategoryChoices(raw, skills) {
    const list = parseList(raw);
    const customByTendency = new Map();
    parseList(skills).forEach((s) => {
      const t = normalizeTendency(s?.tendency);
      if (!customByTendency.has(t) && s?.id && !isSystemPromptSkill(s)) {
        customByTendency.set(t, String(s.id));
      }
    });
    const seen = new Set();
    const out = [];
    list.forEach((c) => {
      const tendency = normalizeTendency(c?.tendency);
      if (!tendency || seen.has(tendency)) return;
      seen.add(tendency);
      const source = String(c?.source || '').trim() === 'custom' ? 'custom' : 'system';
      const choice = { tendency, source };
      if (source === 'custom') {
        choice.customSkillId = String(c?.customSkillId || c?.custom_skill_id || customByTendency.get(tendency) || '').trim();
      }
      out.push(choice);
    });
    return out;
  }

  function normalizeStore(raw) {
    const skills = parseList(raw?.skills).map((s) => normalizeSkill(s));
    let activeSkillId = String(raw?.activeSkillId || '').trim();
    if (activeSkillId && !skills.some((s) => s.id === activeSkillId)) {
      activeSkillId = '';
    }
    return {
      skills,
      activeSkillId,
      categoryChoices: normalizeCategoryChoices(raw?.categoryChoices || raw?.category_choices, skills),
    };
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
    const prev = idx >= 0 ? st.skills[idx] : null;
    if (isSystemPromptSkill(prev || { id, readonly: incoming.readonly })) {
      throw new Error('system prompt skill is read-only');
    }
    let syncTarget = incoming.syncTarget;
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'syncTarget')) {
      syncTarget = prev ? prev.syncTarget : SYNC_LOCAL;
    } else if (!syncTarget && !prev) {
      syncTarget = SYNC_LOCAL;
    }
    const next = { ...incoming, id, updatedAt: now, syncTarget };
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

  function catalogIdSet(catalogOrIds) {
    if (catalogOrIds instanceof Set) return catalogOrIds;
    const list = Array.isArray(catalogOrIds) ? catalogOrIds : parseList(catalogOrIds?.skills);
    return new Set(list.map((s) => String(s?.id || '').trim()).filter(Boolean));
  }

  function bundledPresetIdSet() {
    const Preset = typeof globalThis !== 'undefined' ? globalThis.PageAdvisorPresetSkills : null;
    const ids = Preset && typeof Preset.bundledPresetIds === 'function' ? Preset.bundledPresetIds() : [];
    return new Set(ids);
  }

  function isSystemPromptSkill(skill, catalogIds) {
    const rec = skill && typeof skill === 'object' ? skill : { id: skill };
    const id = String(rec.id || '').trim();
    if (!id) return false;
    if (rec.readonly) return true;
    if (bundledPresetIdSet().has(id)) return true;
    return catalogIdSet(catalogIds).has(id);
  }

  function removeSkill(store, skillId, catalogIds) {
    const st = normalizeStore(store);
    const id = String(skillId || '').trim();
    const existing = st.skills.find((s) => s.id === id);
    if (existing && isSystemPromptSkill(existing, catalogIds)) {
      throw new Error('system prompt skill is read-only');
    }
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

  /**
   * @param {object} storeObj 本机文档
   * @param {string} [baseRevision] 本机上次看到的服务端版本；非空时服务端做 CAS，
   *   不一致返回 409（OPT-20260922-003）。省略即旧的 last-write-wins 行为。
   */
  function toApiPayload(storeObj, baseRevision = '') {
    const st = normalizeStore(storeObj);
    const payload = {
      skills: persistSkillsOf(st).map((s) => ({
        id: s.id,
        title: s.title,
        tendency: s.tendency,
        body: s.body,
        updated_at: s.updatedAt,
      })),
      active_skill_id: st.activeSkillId,
    };
    if (st.categoryChoices.length) {
      payload.category_choices = st.categoryChoices.map((c) => ({
        tendency: c.tendency,
        source: c.source,
        custom_skill_id: c.customSkillId || undefined,
      }));
    }
    const base = String(baseRevision || '').trim();
    if (base) payload.base_revision = base;
    return payload;
  }

  function fromApiPayload(raw, workspaceId) {
    const wid = String(workspaceId || '').trim();
    const list = parseList(raw?.skills).map((s) => normalizeSkill({
      id: s.id,
      title: s.title,
      tendency: s.tendency,
      body: s.body,
      updatedAt: s.updatedAt || s.updated_at,
      syncTarget: wid,
      readonly: Boolean(s.readonly),
    }));
    return normalizeStore({
      skills: list,
      activeSkillId: raw?.activeSkillId || raw?.active_skill_id || '',
      categoryChoices: raw?.categoryChoices || raw?.category_choices,
    });
  }

  /** 预埋五类稳定 id；已有 id 不改 active；系统 id 始终用目录或打包快照覆盖 title/body。 */
  function applySystemCatalogDefault(localStore, catalog, syncTarget, opts) {
    const local = normalizeStore(localStore);
    const Preset = typeof globalThis !== 'undefined' ? globalThis.PageAdvisorPresetSkills : null;
    if (!Preset) return { store: local, action: 'noop' };
    const catalogList = parseList(catalog?.skills);
    const sourceList = catalogList.length ? catalogList : Preset.bundledPresetSkills();
    void opts;
    const target = normalizeSyncTarget(syncTarget) || SYNC_LOCAL;
    const skills = local.skills.slice();
    let inserted = 0;
    let overlaid = 0;
    let insertedCustomId = '';
    Preset.TENDENCIES.forEach((t) => {
      const preset = Preset.PRESET_CATEGORY_DEFAULTS[t];
      const stableId = preset.id;
      const live = catalogList.find((s) => String(s?.id || '').trim() === stableId) || null;
      const raw = live || Preset.catalogRowForPreset(sourceList, preset) || preset;
      const existingIdx = skills.findIndex((s) => s.id === stableId);
      if (existingIdx >= 0) {
        const prev = skills[existingIdx];
        const next = normalizeSkill({
          ...prev,
          title: raw.title || prev.title,
          tendency: raw.tendency || prev.tendency,
          body: raw.body != null && raw.body !== undefined ? raw.body : prev.body,
          updatedAt: raw.updatedAt || raw.updated_at || prev.updatedAt,
          syncTarget: prev.syncTarget || target,
          readonly: true,
        });
        if (next.title !== prev.title || next.body !== prev.body || !prev.readonly) {
          skills[existingIdx] = next;
          overlaid += 1;
        }
        return;
      }
      if (skills.length >= MAX_SKILLS) return;
      skills.push(normalizeSkill({
        id: stableId,
        title: raw.title || preset.title,
        tendency: preset.tendency,
        body: raw.body || preset.body,
        updatedAt: raw.updatedAt || raw.updated_at,
        syncTarget: target,
        readonly: true,
      }));
      inserted += 1;
      if (t === 'custom') insertedCustomId = stableId;
    });
    if (!inserted && !overlaid) return { store: local, action: 'noop' };
    const keepEmptyActive = !local.activeSkillId && local.skills.length > 0;
    const activeSkillId = local.activeSkillId
      ? local.activeSkillId
      : (keepEmptyActive ? '' : insertedCustomId);
    return {
      store: { ...local, skills, activeSkillId },
      action: 'applied',
    };
  }

  /**
   * 把某一工作空间的云端整包并入本机并集：本机-only 与其它空间的 Skill 保留。
   */
  function mergeWorkspaceBundle(localStore, remotePayload, workspaceId, legacyWorkspaceId) {
    const local = normalizeStore(localStore);
    const wid = String(workspaceId || '').trim();
    const remote = fromApiPayload(remotePayload || {}, wid);
    const revision = String(remotePayload?.revision || '').trim();
    const ours = local.skills.filter((s) => skillTargetsWorkspace(s, wid, legacyWorkspaceId));
    if (persistSkillsOf(remote).length === 0 && ours.filter((s) => !isSystemPromptSkill(s)).length > 0) {
      return { store: local, action: 'upload', revision };
    }
    if (remote.skills.length === 0) {
      return { store: local, action: 'noop', revision };
    }
    const localOnly = local.skills.filter((s) => s.syncTarget === SYNC_LOCAL);
    const otherWs = local.skills.filter((s) => {
      const t = s.syncTarget;
      return t && t !== SYNC_LOCAL && t !== wid;
    });
    const reservedIds = new Set([...localOnly, ...otherWs].map((s) => s.id));
    const incoming = remote.skills.filter((s) => !reservedIds.has(s.id));
    const skills = localOnly.concat(otherWs, incoming);
    const remoteActive = String(remote.activeSkillId || '').trim();
    const hadRemoteActive = !!(remoteActive && local.skills.some((s) => s.id === remoteActive));
    let activeSkillId = local.activeSkillId;
    if (activeSkillId && !skills.some((s) => s.id === activeSkillId)) {
      activeSkillId = remoteActive && skills.some((s) => s.id === remoteActive)
        ? remoteActive
        : '';
    } else if (!activeSkillId && remoteActive && !hadRemoteActive && skills.some((s) => s.id === remoteActive)) {
      activeSkillId = remoteActive;
    }
    return { store: { skills, activeSkillId, categoryChoices: remote.categoryChoices }, action: 'pull', revision };
  }

  /**
   * 生成某一工作空间 PUT 正文：同事的 Skill（本机没有的 id）+ 本机指定同步到该空间的 Skill。
   */
  function buildWorkspacePutStore(localStore, remotePayload, workspaceId, legacyWorkspaceId) {
    const local = normalizeStore(localStore);
    const wid = String(workspaceId || '').trim();
    const remote = fromApiPayload(remotePayload || {}, wid);
    const managedIds = new Set(local.skills.map((s) => s.id));
    const colleague = persistSkillsOf({ skills: remote.skills.filter((s) => !managedIds.has(s.id)) });
    const ours = local.skills.filter((s) => skillTargetsWorkspace(s, wid, legacyWorkspaceId) && !isSystemPromptSkill(s));
    const skills = colleague.concat(ours);
    let activeSkillId = local.activeSkillId;
    if (!skills.some((s) => s.id === activeSkillId) && !remote.skills.some((s) => s.id === activeSkillId && isSystemPromptSkill(s))) {
      activeSkillId = remote.activeSkillId && (skills.some((s) => s.id === remote.activeSkillId) || remote.skills.some((s) => s.id === remote.activeSkillId))
        ? remote.activeSkillId
        : (ours[0]?.id || colleague[0]?.id || remote.activeSkillId || '');
    }
    return { skills, activeSkillId, categoryChoices: local.categoryChoices.length ? local.categoryChoices : remote.categoryChoices };
  }

  /**
   * 云端有数据则以云端为准；云端空且本机有数据则应上传。
   * revision 为云端当前版本，调用方保存后在 PUT 时作为 base_revision
   * （OPT-20260922-003）。
   * @returns {{ store: object, action: 'pull'|'upload'|'noop', revision: string }}
   */
  function reconcileCloud(localStore, remotePayload) {
    const local = normalizeStore(localStore);
    const remote = fromApiPayload(remotePayload || {});
    const revision = String(remotePayload?.revision || '').trim();
    if (persistSkillsOf(remote).length === 0 && persistSkillsOf(local).length > 0) {
      return { store: local, action: 'upload', revision };
    }
    if (remote.skills.length > 0) {
      return { store: remote, action: 'pull', revision };
    }
    return { store: local, action: 'noop', revision };
  }

  function originFromApiBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';
    try {
      const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.origin;
    } catch (_) {
      return '';
    }
  }

  function workspaceIdForSkill(skill, lastWorkspaceId) {
    const tgt = normalizeSyncTarget(skill && skill.syncTarget);
    if (tgt && tgt !== SYNC_LOCAL) return tgt;
    return String(lastWorkspaceId || '').trim();
  }

  function buildPromptSkillsPageHref(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const origin = originFromApiBaseUrl(o.baseUrl);
    const tid = String(o.tenantId || '').trim();
    const wid = String(o.workspaceId || '').trim();
    if (!origin || !tid || !wid) return '';
    return origin + '/tenant/' + encodeURIComponent(tid)
      + '/settings/workspace/' + encodeURIComponent(wid) + '/prompt-skills/';
  }

  return {
    STORAGE_KEYS,
    MAX_SKILLS,
    MAX_BODY,
    MAX_TITLE,
    MAX_TENDENCY,
    TENDENCIES,
    SYNC_LOCAL,
    emptyStore,
    normalizeSyncTarget,
    skillTargetsWorkspace,
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
    toApiPayload,
    fromApiPayload,
    reconcileCloud,
    mergeWorkspaceBundle,
    applySystemCatalogDefault,
    bundledPresetSkills: () => (globalThis.PageAdvisorPresetSkills && globalThis.PageAdvisorPresetSkills.bundledPresetSkills()) || [],
    bundledPresetIds: () => (globalThis.PageAdvisorPresetSkills && globalThis.PageAdvisorPresetSkills.bundledPresetIds()) || [],
    groupSkillsByTendency: (skills, opts) => (globalThis.PageAdvisorPresetSkills && globalThis.PageAdvisorPresetSkills.groupSkillsByTendency(skills, opts)) || [],
    buildWorkspacePutStore,
    workspaceIdForSkill,
    buildPromptSkillsPageHref,
    catalogIdSet,
    isSystemPromptSkill,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPromptSkills;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPromptSkills = PageAdvisorPromptSkills;
}
