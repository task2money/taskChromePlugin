/**
 * 自动创新直连 LLM 配置（纯函数 + chrome.storage 读写）。
 * 密钥只存本机 local，不上传 SaaS。可保存多组，当前组镜像到旧的单 Key 字段。
 */

'use strict';

const PageAdvisorLlmConfig = (() => {
  const STORAGE_KEYS = {
    // Secret-Hardcode-OK: chrome.storage 键名，不是凭据字面量
    apiKey: 'pageAdvisorLlmApiKey',
    baseUrl: 'pageAdvisorLlmBaseUrl',
    model: 'pageAdvisorLlmModel',
    routeMode: 'pageAdvisorLlmRoute',
    profiles: 'pageAdvisorLlmProfiles',
    activeProfileId: 'pageAdvisorLlmActiveProfileId',
    draft: 'pageAdvisorLlmDraft',
  };

  const MAX_PROFILES = 20;
  const LEGACY_PROFILE_ID = 'legacy';
  const READ_KEYS = [
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.baseUrl,
    STORAGE_KEYS.model,
    STORAGE_KEYS.routeMode,
    STORAGE_KEYS.profiles,
    STORAGE_KEYS.activeProfileId,
  ];

  function profileError(code) {
    const err = new Error(code);
    err.code = code;
    return err;
  }

  function newProfileId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `p_${crypto.randomUUID()}`;
    }
    return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

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

  /** 未保存过调用方式时默认直连。显式 direct/saas 覆盖该默认。 */
  function resolveRoute(cfg) {
    const c = normalizeConfig(cfg);
    if (c.routeMode) return c.routeMode;
    return 'direct';
  }

  function keyTail(apiKey) {
    const s = String(apiKey || '');
    if (s.length < 8) return '';
    return s.slice(-4);
  }

  /** 下拉文案不得包含完整 API Key。 */
  function profileOptionLabel(profile, unnamed) {
    const secret = String(profile?.apiKey || '');
    let name = String(profile?.label || '').trim() || String(profile?.model || '').trim();
    if (!name) name = String(unnamed || '未命名');
    if (secret && name.includes(secret)) name = name.split(secret).join('…');
    name = name.trim().slice(0, 48) || String(unnamed || '未命名');
    const tail = keyTail(secret);
    return tail ? `${name} · …${tail}` : name;
  }

  function normalizeProfile(raw) {
    const id = String(raw?.id || '').trim();
    if (!id) return null;
    const cfg = normalizeConfig(raw);
    return {
      id,
      label: String(raw?.label || '').trim().slice(0, 48),
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    };
  }

  function parseProfiles(raw) {
    let list = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) list = [];
      else {
        try { list = JSON.parse(trimmed); } catch (_) { list = []; }
      }
    }
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const profile = normalizeProfile(item);
      if (!profile || seen.has(profile.id)) continue;
      seen.add(profile.id);
      out.push(profile);
      if (out.length >= MAX_PROFILES) break;
    }
    return out;
  }

  function legacyProfile(cfg) {
    if (!cfg.apiKey && !cfg.baseUrl && !cfg.model) return null;
    return {
      id: LEGACY_PROFILE_ID,
      label: '',
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
    };
  }

  function pickActive(profiles, activeId) {
    if (!profiles.length) return null;
    return profiles.find((p) => p.id === activeId) || profiles[0];
  }

  function pack(profiles, active, routeMode) {
    const cfg = normalizeConfig({
      apiKey: active?.apiKey,
      baseUrl: active?.baseUrl,
      model: active?.model,
      routeMode,
    });
    return {
      ...cfg,
      profiles,
      activeProfileId: active?.id || '',
      profileLabel: active?.label || '',
    };
  }

  function draftFrom(cfg) {
    const normalized = normalizeConfig(cfg);
    return {
      label: String(cfg?.profileLabel || '').trim().slice(0, 48),
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
    };
  }

  function isComplete(draft) {
    return Boolean(draft.apiKey && draft.baseUrl && draft.model);
  }

  function applyProfileMutation(state, cfg) {
    const profiles = parseProfiles(state?.profiles);
    let activeProfileId = String(state?.activeProfileId || '');
    const action = String(cfg?.profileAction || 'upsert-active');
    const routeMode = cfg && Object.prototype.hasOwnProperty.call(cfg, 'routeMode')
      ? normalizeRouteMode(cfg.routeMode)
      : normalizeRouteMode(state?.routeMode);

    if (action === 'route-only') {
      return pack(profiles, pickActive(profiles, activeProfileId), routeMode);
    }

    if (action === 'activate') {
      const hit = profiles.find((p) => p.id === String(cfg?.profileId || ''));
      if (!hit) throw profileError('profile_not_found');
      return pack(profiles, hit, routeMode);
    }

    if (action === 'delete') {
      const id = String(cfg?.profileId || '');
      const next = profiles.filter((p) => p.id !== id);
      if (activeProfileId === id) activeProfileId = next[0]?.id || '';
      if (activeProfileId && !next.some((p) => p.id === activeProfileId)) {
        activeProfileId = next[0]?.id || '';
      }
      return pack(next, pickActive(next, activeProfileId), routeMode);
    }

    const draft = draftFrom(cfg);
    if (action === 'create') {
      if (!isComplete(draft)) throw profileError('profile_incomplete');
      if (profiles.length >= MAX_PROFILES) throw profileError('profile_limit');
      const created = { id: newProfileId(), ...draft };
      profiles.push(created);
      return pack(profiles, created, routeMode);
    }

    const targetId = action === 'update'
      ? String(cfg?.profileId || '')
      : activeProfileId;
    const idx = profiles.findIndex((p) => p.id === targetId);
    if (idx < 0) {
      if (!isComplete(draft)) {
        return pack(profiles, pickActive(profiles, activeProfileId), routeMode);
      }
      if (profiles.length >= MAX_PROFILES) throw profileError('profile_limit');
      const created = { id: newProfileId(), ...draft };
      profiles.push(created);
      return pack(profiles, created, routeMode);
    }
    const prev = profiles[idx];
    const next = {
      id: prev.id,
      label: cfg && Object.prototype.hasOwnProperty.call(cfg, 'profileLabel') ? draft.label : prev.label,
      apiKey: draft.apiKey,
      baseUrl: draft.baseUrl,
      model: draft.model,
    };
    profiles[idx] = next;
    return pack(profiles, next, routeMode);
  }

  function storageOf(storageApi) {
    if (storageApi) return storageApi;
    if (typeof Storage !== 'undefined' && Storage && typeof Storage.get === 'function') return Storage;
    return null;
  }

  async function readStored(store) {
    if (!store || typeof store.get !== 'function') return pack([], null, '');
    const raw = await store.get(READ_KEYS);
    const legacy = normalizeConfig({
      apiKey: raw?.[STORAGE_KEYS.apiKey],
      baseUrl: raw?.[STORAGE_KEYS.baseUrl],
      model: raw?.[STORAGE_KEYS.model],
      routeMode: raw?.[STORAGE_KEYS.routeMode],
    });
    let profiles = parseProfiles(raw?.[STORAGE_KEYS.profiles]);
    let migrated = false;
    if (!profiles.length) {
      const one = legacyProfile(legacy);
      if (one) {
        profiles = [one];
        migrated = true;
      }
    }
    const active = pickActive(
      profiles,
      migrated ? LEGACY_PROFILE_ID : String(raw?.[STORAGE_KEYS.activeProfileId] || ''),
    );
    const packed = pack(profiles, active, legacy.routeMode);
    packed.migrated = migrated;
    return packed;
  }

  function publicBundle(bundle) {
    const out = { ...bundle };
    delete out.migrated;
    return out;
  }

  async function loadFromStorage(storageApi) {
    const store = storageOf(storageApi);
    const bundle = await readStored(store);
    if (bundle.migrated && store && typeof store.set === 'function') {
      await store.set({
        [STORAGE_KEYS.profiles]: bundle.profiles,
        [STORAGE_KEYS.activeProfileId]: bundle.activeProfileId,
      });
    }
    return publicBundle(bundle);
  }

  async function saveToStorage(cfg, storageApi) {
    const store = storageOf(storageApi);
    if (!store || typeof store.set !== 'function') {
      throw new Error('storage unavailable');
    }
    const prev = await readStored(store);
    const next = applyProfileMutation(prev, cfg || {});
    await store.set({
      [STORAGE_KEYS.apiKey]: next.apiKey,
      [STORAGE_KEYS.baseUrl]: next.baseUrl,
      [STORAGE_KEYS.model]: next.model,
      [STORAGE_KEYS.routeMode]: next.routeMode,
      [STORAGE_KEYS.profiles]: next.profiles,
      [STORAGE_KEYS.activeProfileId]: next.activeProfileId,
    });
    return publicBundle(next);
  }

  function parseDraft(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const draft = {
      profileId: String(raw.profileId || ''),
      label: String(raw.label ?? ''),
      apiKey: String(raw.apiKey ?? ''),
      baseUrl: String(raw.baseUrl ?? ''),
      model: String(raw.model ?? ''),
    };
    if (!draft.profileId && !draft.label && !draft.apiKey && !draft.baseUrl && !draft.model) {
      return null;
    }
    return draft;
  }

  /** 草稿与当前生效组完全一致时不必再展开恢复。 */
  function shouldRestoreDraft(draft, cfg) {
    const parsed = parseDraft(draft);
    if (!parsed) return false;
    const base = String(parsed.baseUrl || '').trim().replace(/\/+$/, '');
    const activeBase = String(cfg?.baseUrl || '').trim().replace(/\/+$/, '');
    const same = parsed.profileId === String(cfg?.activeProfileId || '')
      && parsed.label === String(cfg?.profileLabel || '')
      && parsed.apiKey === String(cfg?.apiKey || '')
      && parsed.model === String(cfg?.model || '')
      && base === activeBase;
    return !same;
  }

  async function loadDraftFromStorage(storageApi) {
    const store = storageOf(storageApi);
    if (!store || typeof store.get !== 'function') return null;
    const raw = await store.get([STORAGE_KEYS.draft]);
    return parseDraft(raw?.[STORAGE_KEYS.draft]);
  }

  async function clearDraftFromStorage(storageApi) {
    const store = storageOf(storageApi);
    if (!store) return;
    if (typeof store.remove === 'function') {
      await store.remove([STORAGE_KEYS.draft]);
      return;
    }
    if (typeof store.set === 'function') {
      await store.set({ [STORAGE_KEYS.draft]: null });
    }
  }

  async function saveDraftToStorage(draft, storageApi) {
    const store = storageOf(storageApi);
    if (!store || typeof store.set !== 'function') {
      throw new Error('storage unavailable');
    }
    const parsed = parseDraft(draft);
    if (!parsed) {
      await clearDraftFromStorage(store);
      return null;
    }
    await store.set({ [STORAGE_KEYS.draft]: parsed });
    return parsed;
  }

  async function activateProfile(profileId, storageApi) {
    const store = storageOf(storageApi);
    const prev = await readStored(store);
    return saveToStorage({
      profileAction: 'activate',
      profileId,
      routeMode: prev.routeMode,
    }, store);
  }

  return {
    STORAGE_KEYS,
    MAX_PROFILES,
    normalizeConfig,
    normalizeRouteMode,
    isDirectLlmReady,
    resolveRoute,
    profileOptionLabel,
    parseProfiles,
    applyProfileMutation,
    loadFromStorage,
    saveToStorage,
    activateProfile,
    parseDraft,
    shouldRestoreDraft,
    loadDraftFromStorage,
    saveDraftToStorage,
    clearDraftFromStorage,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorLlmConfig;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorLlmConfig = PageAdvisorLlmConfig;
}
