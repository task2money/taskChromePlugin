(function () {
  const $ = (sel) => document.querySelector(sel);
  const Ui = () => (typeof PopupLlmSettingsUi !== 'undefined' ? PopupLlmSettingsUi : null);
  let store = { skills: [], activeSkillId: '' };
  let saveBusy = false;
  let deleteBusy = false;
  let pendingDeleteId = '';
  let cloudRevisions = {};
  let pendingConflict = null;
  let pendingConflictWorkspaceId = '';
  let scopeProvider = null;
  let workspaceRows = [];
  const lwwWorkspaceIds = new Set();
  let lastKnownWorkspaceId = '';
  let cachedBaseUrl = '';
  let systemCatalogIds = [];
  const skillFields = () => $('#pageAdvisorSkillFields');
  const skillToggleBtn = () => $('#btnToggleSkillSettings');
  const Session = () => (typeof PopupPromptSkillSession !== 'undefined' ? PopupPromptSkillSession : null);
  const Cloud = () => (typeof PopupPromptSkillCloud !== 'undefined' ? PopupPromptSkillCloud : null);
  const syncLocalValue = () => (typeof PageAdvisorPromptSkills !== 'undefined' && PageAdvisorPromptSkills.SYNC_LOCAL) || 'local';
  const pluginLoggedIn = () => !!(Session() && Session().isLoggedIn());
  const refreshPluginLoggedIn = () => (Session() ? Session().refreshPluginLoggedIn() : Promise.resolve(false));
  async function refreshLastWorkspace() {
    if (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function') {
      lastKnownWorkspaceId = String(await Storage.getLastWorkspace() || '').trim();
    }
  }
  async function refreshBaseUrl() {
    try {
      if (typeof Storage !== 'undefined' && typeof Storage.getApiConfig === 'function') {
        cachedBaseUrl = String((await Storage.getApiConfig())?.baseUrl || '').trim();
      }
    } catch (_) { /* keep previous */ }
  }

  async function resolveSkillScope() {
    if (typeof scopeProvider === 'function') {
      return scopeProvider();
    }
    await refreshLastWorkspace();
    let workspaceId = lastKnownWorkspaceId;
    await refreshWorkspaceRows();
    const ws = workspaceRows.find((row) => String(row?.id || row?._id || '') === workspaceId);
    const tenantId = String(ws?.company_id || ws?.companyId || '').trim();
    if (!workspaceId || !tenantId) return null;
    return { tenantId, workspaceId };
  }

  async function refreshWorkspaceRows() {
    if (typeof sendMessageWithTimeout !== 'function') return;
    try {
      const r = await sendMessageWithTimeout({ action: 'getWorkspaces' }, 12000);
      const data = r?.data;
      workspaceRows = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
    } catch (_) {
      workspaceRows = workspaceRows || [];
    }
  }

  /** 打开弹窗时最多补拉的工作空间数（OPT-20260922-015）：成员空间逐个 GET 是只读且限量的。 */
  const MAX_PULL_WORKSPACES = 10;

  /**
   * 除本机已标记的目标外，还要补拉的成员空间（OPT-20260922-015）。
   * 用户从未在本机给某空间打标时，其它电脑写入该空间的 Skill 不会自动出现，
   * 「同步到工作空间 B」换电脑后看起来像丢了。默认空间优先，其余按列表序截断。
   */
  function memberWorkspaceIdsForPull(legacyWorkspaceId) {
    const legacy = String(legacyWorkspaceId || '').trim();
    const ids = [];
    (workspaceRows || []).forEach((row) => {
      const id = String(row?.id || row?._id || '').trim();
      if (!id || ids.includes(id) || !tenantForWorkspace(id)) return;
      ids.push(id);
    });
    ids.sort((a, b) => (a === legacy ? -1 : 0) - (b === legacy ? -1 : 0));
    return ids.slice(0, MAX_PULL_WORKSPACES);
  }

  function tenantForWorkspace(workspaceId) {
    const ws = workspaceRows.find((row) => String(row?.id || row?._id || '') === String(workspaceId || '').trim());
    return String(ws?.company_id || ws?.companyId || '').trim();
  }

  function setSkillSectionVisible(visible) {
    const sec = $('#pageAdvisorSkillSection');
    if (sec) sec.style.display = visible ? 'block' : 'none';
  }

  /**
   * 未登录时展开弹窗登录表单（OPT-20260922-040）。
   * 登录按钮在顶栏、Skill 状态在折叠区底部，「skills stay on this device」文案容易被
   * 误读成「网站已登录」，所以把「须在本弹窗登录」变成同屏可点动作。
   * 折叠态由 popup-auth.js 的 `setLoginFormExpanded`（SSOT）持有，这里只调用，不重复实现。
   */
  function revealLoginFormForSignedOut() {
    const loginSec = $('#loginSection');
    if (!loginSec || loginSec.style.display === 'block') return;
    // 非 Popup 上下文（无 popup-auth.js，如 DevTools 面板/单测）时无可展开的表单
    if (typeof setLoginFormExpanded !== 'function') return;
    setLoginFormExpanded(true);
  }
  function statusText(msg) {
    const el = $('#popupSkillStatus');
    if (el) el.textContent = msg || '';
  }
  function statusCloudFail(e) {
    const tid = e?.traceId || '';
    if (tid && $('#popupSkillStatus')) $('#popupSkillStatus').setAttribute('data-traceId', tid);
    statusText(tid ? `${tx('paSkillSavedLocalCloudFailed')} (${tid})` : tx('paSkillSavedLocalCloudFailed'));
  }

  function newIdempotencyKey() {
    return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID() : `psk_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function defaultSyncTarget() {
    const s = Session();
    return s ? s.defaultSyncTarget(lastKnownWorkspaceId, syncLocalValue()) : (lastKnownWorkspaceId || syncLocalValue());
  }

  function fillEditor(skill) {
    const SkillUi = globalThis.PopupPromptSkillUi;
    if (SkillUi) SkillUi.fillEditor(skill, store, defaultSyncTarget(), workspaceRows, syncLocalValue());
  }
  function setEditorVisible(open) {
    const SkillUi = globalThis.PopupPromptSkillUi;
    if (SkillUi) SkillUi.setEditorVisible(open);
  }
  function renderList() {
    const SkillUi = globalThis.PopupPromptSkillUi;
    if (SkillUi) SkillUi.renderActiveSummary($('#popupSkillActiveSummary'), store);
    if (!SkillUi) return;
    SkillUi.renderSkillList($('#popupSkillList'), store, syncLocalValue(), workspaceRows, {
      onActive: (id) => {
        applyActive(id).catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      },
      onTarget: (id, value) => {
        changeSkillTarget(id, value).catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      },
      onEdit: fillEditor,
      onDelete: (sk) => { openDeleteConfirm(sk); },
      onCategorySource: (tendency, source) => {
        changeCategorySource(tendency, source).catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      },
      onMissingWorkspace: () => statusText(tx('paSkillNeedWorkspace')),
    }, { baseUrl: cachedBaseUrl, lastWorkspaceId: lastKnownWorkspaceId, systemSkillIds: systemCatalogIds });
  }

  function cloudCtx() {
    return {
      getStore: () => store,
      setStore: (next) => { store = next; },
      cloudRevisions,
      lwwWorkspaceIds,
      syncLocalValue,
      pluginLoggedIn,
      refreshWorkspaceRows,
      tenantForWorkspace,
      resolveSkillScope,
      resolveAdvisorSession: () => (Session() ? Session().resolveAdvisorSession() : Promise.resolve(null)),
      newIdempotencyKey,
      statusText,
      statusCloudFail,
      renderList,
      setEditorVisible,
      storage: () => (typeof Storage !== 'undefined' ? Storage : null),
      saveBusy: () => saveBusy,
      setSaveBusy: (v) => { saveBusy = v; },
      pendingConflict: () => pendingConflict,
      pendingConflictWorkspaceId: () => pendingConflictWorkspaceId,
      setPendingConflict: (body, wid) => {
        pendingConflict = body;
        pendingConflictWorkspaceId = wid || '';
      },
    };
  }

  function collectPushWorkspaceIds(legacyWorkspaceId) {
    return Cloud().collectPushWorkspaceIds(store, cloudRevisions, syncLocalValue(), legacyWorkspaceId);
  }

  async function persist() {
    return Cloud().persist(cloudCtx());
  }

  async function applyActive(id) {
    store = PageAdvisorPromptSkills.setActive(store, id).store;
    await persist();
    renderList();
  }

  /**
   * 预设类别的「系统默认 / 自行定制」（OPT-20260922-043）。
   * 定制时由运行时把目录正文 clone 成本机新 id（系统只读条不改写），随即展开编辑区。
   */
  async function changeCategorySource(tendency, source) {
    const rec = PageAdvisorPromptSkills.selectCategorySource(store, tendency, source);
    if (!rec.store || rec.store === store) return;
    store = rec.store;
    const ok = await persist();
    renderList();
    if (rec.created && rec.customSkillId) {
      fillEditor(store.skills.find((sk) => sk.id === rec.customSkillId) || null);
      statusText(tx('paSkillCategoryCustomCreated'));
      return;
    }
    if (ok) statusText(tx('paSkillSavedLocal'));
  }

  async function changeSkillTarget(skillId, syncTarget) {
    const sk = store.skills.find((s) => s.id === skillId);
    if (!sk) return;
    store = PageAdvisorPromptSkills.upsertSkill(store, { ...sk, syncTarget }).store;
    const ok = await persist();
    renderList();
    if (ok) {
      statusText(syncTarget === syncLocalValue() ? tx('paSkillSavedLocal') : tx('paSkillSaved'));
    }
  }

  async function loadSkills() {
    if (typeof PageAdvisorPromptSkills === 'undefined') return;
    setSkillSectionVisible(true);
    const ui = Ui();
    if (ui) ui.setLlmSettingsExpanded(skillFields(), skillToggleBtn(), false);
    try {
      store = await PageAdvisorPromptSkills.loadFromStorage(
        typeof Storage !== 'undefined' ? Storage : null,
      );
      await refreshPluginLoggedIn();
      await refreshLastWorkspace();
      await refreshBaseUrl();
      await refreshWorkspaceRows();
    } catch (e) {
      console.warn('[taskChromePlugin] load prompt skills:', e?.message || e);
    }
    const api = typeof PageAdvisorAPI !== 'undefined' ? PageAdvisorAPI : null;
    const advisorSession = Session() ? await Session().resolveAdvisorSession() : null;
    try {
      if (pluginLoggedIn() && api && typeof api.getPromptSkills === 'function' && advisorSession) {
        const scope = await resolveSkillScope();
        const legacy = scope?.workspaceId || '';
        const wids = new Set(collectPushWorkspaceIds(legacy));
        if (legacy) wids.add(legacy);
        memberWorkspaceIdsForPull(legacy).forEach((id) => wids.add(id));
        let needUpload = false;
        let didPull = false;
        for (const wid of wids) {
          const tenantId = tenantForWorkspace(wid) || (wid === legacy ? scope?.tenantId : '');
          if (!tenantId) continue;
          const remote = await api.getPromptSkills(tenantId, wid, advisorSession);
          const rec = PageAdvisorPromptSkills.mergeWorkspaceBundle(store, remote, wid, legacy);
          store = rec.store;
          if (rec.revision) cloudRevisions[wid] = rec.revision;
          if (rec.action === 'upload') needUpload = true;
          if (rec.action === 'pull') didPull = true;
        }
        if (needUpload) {
          await persist();
          statusText(tx('paSkillSyncedUpload'));
        } else if (didPull) {
          await PageAdvisorPromptSkills.saveToStorage(
            store, typeof Storage !== 'undefined' ? Storage : null,
          );
          statusText(tx('paSkillSyncedPull'));
        }
      } else if (pluginLoggedIn() && !advisorSession) {
        statusText(tx('paSkillCatalogNeedSession'));
      }
    } catch (e) {
      console.warn('[taskChromePlugin] sync prompt skills:', e?.message || e);
    }
    try {
      const bundledIds = typeof PageAdvisorPromptSkills.bundledPresetIds === 'function'
        ? PageAdvisorPromptSkills.bundledPresetIds()
        : [];
      systemCatalogIds = bundledIds.slice();
      let catalog = {
        skills: typeof PageAdvisorPromptSkills.bundledPresetSkills === 'function'
          ? PageAdvisorPromptSkills.bundledPresetSkills()
          : [],
      };
      let overlayExisting = false;
      if (pluginLoggedIn() && api && typeof api.getSystemPromptSkills === 'function' && advisorSession) {
        const cat = await api.getSystemPromptSkills(advisorSession);
        const live = (cat && cat.skills) || [];
        if (live.length) {
          catalog = cat;
          overlayExisting = true;
        }
        systemCatalogIds = [...new Set(bundledIds.concat(
          live.map((s) => String(s.id || '').trim()).filter(Boolean),
        ))];
      }
      const rec = PageAdvisorPromptSkills.applySystemCatalogDefault(
        store, catalog, lastKnownWorkspaceId || syncLocalValue(), { overlayExisting },
      );
      store = rec.store;
      const ids = new Set(systemCatalogIds);
      store = {
        ...store,
        skills: (store.skills || []).map((s) => (ids.has(String(s.id || '').trim()) ? { ...s, readonly: true } : s)),
      };
      if (rec.action === 'applied') {
        await PageAdvisorPromptSkills.saveToStorage(
          store, typeof Storage !== 'undefined' ? Storage : null,
        );
        if (pluginLoggedIn()) statusText(tx('paSkillSyncedPull'));
      } else if (pluginLoggedIn() && overlayExisting && !((catalog && catalog.skills) || []).length) {
        statusText(tx('paSkillCatalogEmpty'));
      }
    } catch (e) {
      console.warn('[taskChromePlugin] system catalog:', e?.message || e);
      if (pluginLoggedIn()) statusText(e?.message || tx('paSkillCatalogNeedSession'));
    }
    if (!pluginLoggedIn()) {
      statusText(tx('paSkillLocalOnlyUntilLogin'));
      revealLoginFormForSignedOut();
    }
    renderList();
    setEditorVisible(false);
  }

  async function saveSkill() {
    if (saveBusy) return;
    if (typeof PageAdvisorPromptSkills === 'undefined') return;
    saveBusy = true;
    const btn = $('#btnSkillSave');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    const ui = Ui();
    let savedOk = false;
    try {
      const editingId = $('#popupSkillEditingId')?.value || '';
      const existing = store.skills.find((s) => s.id === editingId);
      if (existing && PageAdvisorPromptSkills.isSystemPromptSkill(existing, systemCatalogIds)) {
        setEditorVisible(false);
        savedOk = true;
        return;
      }
      const result = PageAdvisorPromptSkills.upsertSkill(store, {
        id: editingId,
        title: $('#popupSkillTitle')?.value || '',
        tendency: $('#popupSkillTendency')?.value || 'custom',
        body: $('#popupSkillBody')?.value || '',
        syncTarget: $('#popupSkillSyncTarget')?.value || defaultSyncTarget(),
      });
      store = result.store;
      if (!store.activeSkillId) {
        store = PageAdvisorPromptSkills.setActive(store, result.skill.id).store;
      }
      const ok = await persist();
      savedOk = ok;
      const shown = store.skills.find((s) => s.id === result.skill.id)
        || PageAdvisorPromptSkills.getActive(store)
        || store.skills[0]
        || result.skill;
      $('#popupSkillEditingId').value = shown.id || '';
      renderList();
      if (ok) {
        const localOnly = shown.syncTarget === syncLocalValue();
        statusText(localOnly ? tx('paSkillSavedLocal') : tx('paSkillSaved'));
        setEditorVisible(false);
      }
    } catch (e) {
      statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      saveBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
      if (ui) ui.collapseLlmSettingsAfterSave(savedOk, skillFields(), skillToggleBtn());
    }
  }

  function deleteConfirmDialog() {
    return $('#popupSkillDeleteConfirm');
  }

  function openDeleteConfirm(skill) {
    const id = String(skill?.id || '').trim();
    if (!id) return;
    if (typeof PageAdvisorPromptSkills !== 'undefined'
        && PageAdvisorPromptSkills.isSystemPromptSkill(skill, systemCatalogIds)) {
      statusText(tx('paSkillSystemReadonly'));
      return;
    }
    pendingDeleteId = id;
    const msg = $('#popupSkillDeleteConfirmMsg');
    if (msg) msg.textContent = tx('paSkillDeleteConfirm', { title: skill.title || '' });
    const dlg = deleteConfirmDialog();
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else {
      dlg.style.display = 'block';
      dlg.hidden = false;
    }
  }

  function closeDeleteConfirm() {
    pendingDeleteId = '';
    const dlg = deleteConfirmDialog();
    if (!dlg) return;
    if (typeof dlg.close === 'function') {
      if (dlg.open) dlg.close();
    } else {
      dlg.style.display = 'none';
      dlg.hidden = true;
    }
  }

  async function deleteSkill(skillId) {
    if (deleteBusy) return;
    const id = String(skillId || pendingDeleteId || $('#popupSkillEditingId')?.value || '').trim();
    if (!id) return;
    deleteBusy = true;
    const btn = $('#btnSkillDeleteConfirm');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    }
    try {
      store = PageAdvisorPromptSkills.removeSkill(store, id).store;
      const ok = await persist();
      setEditorVisible(false);
      closeDeleteConfirm();
      renderList();
      if (ok) statusText(tx('paSkillDeleted'));
    } catch (e) {
      statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      deleteBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
  }

  function bindEvents() {
    const toggle = skillToggleBtn();
    const ui = Ui();
    // Anti-Replay-OK: ui-only expand/collapse of skill management, no HTTP.
    if (toggle && ui) {
      toggle.addEventListener('click', () => {
        PopupPromptSkillUi.onSkillSettingsToggle(ui, skillFields(), toggle, renderList);
      });
    }
    const save = $('#btnSkillSave');
    if (save) save.addEventListener('click', () => { saveSkill().catch(() => {}); });
    const neu = $('#btnSkillNew');
    // Anti-Replay-OK: ui-only empty editor, no HTTP until save.
    if (neu) neu.addEventListener('click', () => fillEditor(null));
    const delCancel = $('#btnSkillDeleteCancel');
    // Anti-Replay-OK: ui-only dismiss confirm dialog, no HTTP.
    if (delCancel) delCancel.addEventListener('click', () => closeDeleteConfirm());
    const delOk = $('#btnSkillDeleteConfirm');
    if (delOk) delOk.addEventListener('click', () => {
      deleteSkill(pendingDeleteId).catch((e) => statusText(e?.message || tx('popupSaveFailed')));
    });
    const dlg = deleteConfirmDialog();
    if (dlg) {
      dlg.addEventListener('cancel', () => { pendingDeleteId = ''; });
    }
    const keepLocal = $('#btnSkillConflictKeepLocal');
    if (keepLocal) {
      keepLocal.addEventListener('click', () => { Cloud().resolveConflictKeepLocal(cloudCtx()).catch(() => {}); });
    }
    const useCloud = $('#btnSkillConflictUseCloud');
    if (useCloud) {
      useCloud.addEventListener('click', () => { Cloud().resolveConflictUseCloud(cloudCtx()).catch(() => {}); });
    }
  }

  window.PopupPageAdvisorSkills = {
    loadSkills,
    setSkillSectionVisible,
    bindEvents,
    get scopeProvider() { return scopeProvider; },
    set scopeProvider(fn) { scopeProvider = fn; },
    get loggedInProvider() { return Session() ? Session().loggedInProvider : null; },
    set loggedInProvider(fn) { if (Session()) Session().loggedInProvider = fn; },
    get sessionProvider() { return Session() ? Session().sessionProvider : null; },
    set sessionProvider(fn) { if (Session()) Session().sessionProvider = fn; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
