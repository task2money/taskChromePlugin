/**
 * 系统目录预埋：只播种自动创新一条，并卸下已退役的四条预埋 id。
 */
'use strict';

const PageAdvisorPromptSkillCatalog = (() => {
  function applySystemCatalogDefault(localStore, catalog, syncTarget, opts, api) {
    const local = api.normalizeStore(localStore);
    const Preset = typeof globalThis !== 'undefined' ? globalThis.PageAdvisorPresetSkills : null;
    if (!Preset) return { store: local, action: 'noop' };
    void opts;
    const catalogList = api.parseList(catalog && catalog.skills);
    const retired = new Set(
      typeof Preset.retiredBundledIds === 'function' ? Preset.retiredBundledIds() : [],
    );
    const skills = local.skills.filter((s) => {
      if (!retired.has(s.id)) return true;
      const tgt = String(s.syncTarget || '').trim();
      return Boolean(tgt && tgt !== api.SYNC_LOCAL);
    });
    const removed = skills.length !== local.skills.length;
    const droppedActive = retired.has(local.activeSkillId)
      && !skills.some((s) => s.id === local.activeSkillId);
    const target = api.normalizeSyncTarget(syncTarget) || api.SYNC_LOCAL;
    const bundled = typeof Preset.bundledPresetSkills === 'function' ? Preset.bundledPresetSkills() : [];
    let inserted = 0;
    let overlaid = 0;
    let insertedDefaultId = '';
    bundled.forEach((preset) => {
      const stableId = String((preset && preset.id) || '').trim();
      if (!stableId) return;
      const live = catalogList.find((s) => String((s && s.id) || '').trim() === stableId) || null;
      const raw = live || preset;
      const existingIdx = skills.findIndex((s) => s.id === stableId);
      if (existingIdx >= 0) {
        const prev = skills[existingIdx];
        const next = api.normalizeSkill({
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
      if (skills.length >= api.MAX_SKILLS) return;
      skills.push(api.normalizeSkill({
        id: stableId,
        title: raw.title || preset.title,
        tendency: preset.tendency,
        body: raw.body || preset.body,
        updatedAt: raw.updatedAt || raw.updated_at,
        syncTarget: target,
        readonly: true,
      }));
      inserted += 1;
      insertedDefaultId = stableId;
    });
    if (!inserted && !overlaid && !removed) return { store: local, action: 'noop' };
    const keepEmptyActive = !local.activeSkillId && local.skills.length > 0;
    let activeSkillId = droppedActive ? '' : local.activeSkillId;
    if (activeSkillId && !skills.some((s) => s.id === activeSkillId)) activeSkillId = '';
    if (!activeSkillId && !keepEmptyActive) {
      const bundledHit = skills.find((s) => bundled.some((p) => p.id === s.id));
      activeSkillId = insertedDefaultId || (bundledHit && bundledHit.id) || '';
    }
    return {
      store: { ...local, skills, activeSkillId },
      action: 'applied',
    };
  }

  function systemSkillForTendency(storeObj, tendency, api) {
    const st = api.normalizeStore(storeObj);
    const t = api.normalizeTendency(tendency);
    if (!t) return null;
    return st.skills.find((s) => api.normalizeTendency(s.tendency) === t && api.isSystemPromptSkill(s)) || null;
  }

  function categorySourceOf(storeObj, tendency, api) {
    const st = api.normalizeStore(storeObj);
    const t = api.normalizeTendency(tendency);
    const choice = st.categoryChoices.find((c) => c.tendency === t);
    return choice && choice.source === 'custom' ? 'custom' : 'system';
  }

  function selectCategorySource(storeObj, tendency, source, now, api) {
    const st = api.normalizeStore(storeObj);
    const t = api.normalizeTendency(tendency);
    if (!t) return { store: st, customSkillId: '', created: false };
    const wantCustom = String(source || '').trim() === 'custom';
    let skills = st.skills.slice();
    let customSkillId = '';
    let created = false;
    if (wantCustom) {
      const existing = skills.find((s) => api.normalizeTendency(s.tendency) === t && !api.isSystemPromptSkill(s));
      if (existing) {
        customSkillId = String(existing.id || '');
      } else {
        const sys = skills.find((s) => api.normalizeTendency(s.tendency) === t && api.isSystemPromptSkill(s));
        if (!sys || skills.length >= api.MAX_SKILLS) {
          return { store: st, customSkillId: '', created: false };
        }
        const clone = api.normalizeSkill({
          id: api.newSkillId(),
          title: sys.title,
          tendency: t,
          body: sys.body,
          syncTarget: sys.syncTarget,
          readonly: false,
          updatedAt: now,
        });
        skills = skills.concat([clone]);
        customSkillId = clone.id;
        created = true;
      }
    }
    const choice = wantCustom
      ? { tendency: t, source: 'custom', customSkillId }
      : { tendency: t, source: 'system' };
    const categoryChoices = st.categoryChoices.filter((c) => c.tendency !== t).concat([choice]);
    return { store: { ...st, skills, categoryChoices }, customSkillId, created };
  }

  return {
    applySystemCatalogDefault,
    systemSkillForTendency,
    categorySourceOf,
    selectCategorySource,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorPromptSkillCatalog;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorPromptSkillCatalog = PageAdvisorPromptSkillCatalog;
}
