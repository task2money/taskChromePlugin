/**
 * 自动创新倾向 Skill（纯函数 + chrome.storage 缓存）。
 * 登录后与 SaaS 工作空间 `/api/page-advisor/v1/tenant_id/{tenantId}/workspace_id/{workspaceId}/prompt-skills/` 同步；API Key 仍只在本机。
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
  const MAX_TENDENCY = 32;
  const TENDENCIES = ['a11y', 'conversion', 'perf', 'seo', 'custom'];
  const SYNC_LOCAL = 'local';

  function emptyStore() {
    return { skills: [], activeSkillId: '' };
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
    const prev = idx >= 0 ? st.skills[idx] : null;
    if (prev && (prev.readonly || incoming.readonly)) {
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

  function isSystemPromptSkill(skill, catalogIds) {
    const rec = skill && typeof skill === 'object' ? skill : { id: skill };
    const id = String(rec.id || '').trim();
    if (!id) return false;
    if (rec.readonly) return true;
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
      skills: st.skills.map((s) => ({
        id: s.id,
        title: s.title,
        tendency: s.tendency,
        body: s.body,
        updated_at: s.updatedAt,
      })),
      active_skill_id: st.activeSkillId,
    };
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
    });
  }

  function catalogDefaultRaw(catalog) {
    const list = parseList(catalog?.skills);
    return list.find((s) => s && (s.is_default === true || s.isDefault === true)) || null;
  }

  /**
   * 把管理员 is_default Skill 并入本机：仅在本机没有该 id 时插入；
   * active 为空且本次新插入时才选中（已有该 id 的「不应用」不被覆盖）。
   */
  function applySystemCatalogDefault(localStore, catalog, syncTarget) {
    const local = normalizeStore(localStore);
    const raw = catalogDefaultRaw(catalog);
    const id = String(raw?.id || '').trim();
    if (!id) return { store: local, action: 'noop' };
    const incoming = normalizeSkill({
      id,
      title: raw.title,
      tendency: raw.tendency,
      body: raw.body,
      updatedAt: raw.updatedAt || raw.updated_at,
      syncTarget: normalizeSyncTarget(syncTarget) || SYNC_LOCAL,
      readonly: true,
    });
    const had = local.skills.some((s) => s.id === id);
    if (had) return { store: local, action: 'noop' };
    if (local.skills.length >= MAX_SKILLS) return { store: local, action: 'noop' };
    const skills = local.skills.concat(incoming);
    const activeSkillId = local.activeSkillId ? local.activeSkillId : id;
    return { store: { skills, activeSkillId }, action: 'applied' };
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
    if (remote.skills.length === 0 && ours.length > 0) {
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
    return { store: { skills, activeSkillId }, action: 'pull', revision };
  }

  /**
   * 生成某一工作空间 PUT 正文：同事的 Skill（本机没有的 id）+ 本机指定同步到该空间的 Skill。
   */
  function buildWorkspacePutStore(localStore, remotePayload, workspaceId, legacyWorkspaceId) {
    const local = normalizeStore(localStore);
    const wid = String(workspaceId || '').trim();
    const remote = fromApiPayload(remotePayload || {}, wid);
    const managedIds = new Set(local.skills.map((s) => s.id));
    const colleague = remote.skills.filter((s) => !managedIds.has(s.id));
    const ours = local.skills.filter((s) => skillTargetsWorkspace(s, wid, legacyWorkspaceId));
    const skills = colleague.concat(ours);
    let activeSkillId = local.activeSkillId;
    if (!skills.some((s) => s.id === activeSkillId)) {
      activeSkillId = remote.activeSkillId && skills.some((s) => s.id === remote.activeSkillId)
        ? remote.activeSkillId
        : (ours[0]?.id || colleague[0]?.id || '');
    }
    return { skills, activeSkillId };
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
    if (remote.skills.length === 0 && local.skills.length > 0) {
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
