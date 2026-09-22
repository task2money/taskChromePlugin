/** Popup：提示词 Skill CRUD + 按条选择本机或工作空间同步。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const Ui = () => (typeof PopupLlmSettingsUi !== 'undefined' ? PopupLlmSettingsUi : null);
  let store = { skills: [], activeSkillId: '' };
  let saveBusy = false;
  let cloudRevisions = {};
  let pendingConflict = null;
  let pendingConflictWorkspaceId = '';
  let scopeProvider = null;
  let workspaceRows = [];
  let lwwWorkspaceIds = new Set();

  let lastKnownWorkspaceId = '';

  const skillFields = () => $('#pageAdvisorSkillFields');
  const skillToggleBtn = () => $('#btnToggleSkillSettings');
  const syncLocalValue = () => (typeof PageAdvisorPromptSkills !== 'undefined' && PageAdvisorPromptSkills.SYNC_LOCAL) || 'local';

  async function refreshLastWorkspace() {
    if (typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function') {
      lastKnownWorkspaceId = String(await Storage.getLastWorkspace() || '').trim();
    }
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

  function tenantForWorkspace(workspaceId) {
    const ws = workspaceRows.find((row) => String(row?.id || row?._id || '') === String(workspaceId || '').trim());
    return String(ws?.company_id || ws?.companyId || '').trim();
  }

  function fillSyncTargetSelect(selectEl, selected) {
    const SkillUi = globalThis.PopupPromptSkillUi;
    if (SkillUi) SkillUi.fillSyncTargetSelect(selectEl, selected, workspaceRows, syncLocalValue());
  }
  function setSkillSectionVisible(visible) {
    const sec = $('#pageAdvisorSkillSection');
    if (sec) sec.style.display = visible ? 'block' : 'none';
  }
  function statusText(msg) {
    const el = $('#popupSkillStatus');
    if (el) el.textContent = msg || '';
  }

  function newIdempotencyKey() {
    return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `psk_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function defaultSyncTarget() {
    return lastKnownWorkspaceId || syncLocalValue();
  }

  function setEditorVisible(open) {
    const el = $('#popupSkillEditor');
    if (!el) return;
    el.style.display = open ? 'block' : 'none';
    el.hidden = !open;
  }

  function fillEditor(skill) {
    $('#popupSkillEditingId').value = skill?.id || '';
    $('#popupSkillTitle').value = skill?.title || '';
    $('#popupSkillTendency').value = skill?.tendency || 'custom';
    $('#popupSkillBody').value = skill?.body || '';
    fillSyncTargetSelect($('#popupSkillSyncTarget'), skill?.syncTarget || defaultSyncTarget());
    setEditorVisible(true);
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
      onDelete: (id) => { deleteSkill(id).catch((e) => statusText(e?.message || tx('popupSaveFailed'))); },
    });
  }

  function collectPushWorkspaceIds(legacyWorkspaceId) {
    const ids = new Set(Object.keys(cloudRevisions));
    const legacy = String(legacyWorkspaceId || '').trim();
    store.skills.forEach((s) => {
      const t = String(s.syncTarget || '').trim();
      if (t && t !== syncLocalValue()) ids.add(t);
      else if (!t && legacy) ids.add(legacy);
    });
    return [...ids];
  }

  async function pushWorkspaces(scope) {
    if (typeof PageAdvisorAPI === 'undefined' || typeof PageAdvisorAPI.putPromptSkills !== 'function') {
      return { ok: true, localOnly: true };
    }
    await refreshWorkspaceRows();
    const legacyWorkspaceId = String(scope?.workspaceId || '').trim();
    const fallbackTenant = String(scope?.tenantId || '').trim();
    const wids = collectPushWorkspaceIds(legacyWorkspaceId);
    if (!wids.length) return { ok: true, localOnly: true };
    let ok = true;
    for (const wid of wids) {
      const tenantId = tenantForWorkspace(wid) || (wid === legacyWorkspaceId ? fallbackTenant : '');
      if (!tenantId) {
        statusText(tx('paSkillNeedWorkspace'));
        ok = false;
        continue;
      }
      try {
        const remote = await PageAdvisorAPI.getPromptSkills(tenantId, wid);
        const gotRev = String(remote?.revision || '').trim();
        const lww = lwwWorkspaceIds.delete(wid);
        if (!lww && gotRev && !cloudRevisions[wid]) cloudRevisions[wid] = gotRev;
        const putStore = PageAdvisorPromptSkills.buildWorkspacePutStore(store, remote, wid, legacyWorkspaceId);
        const saved = await PageAdvisorAPI.putPromptSkills(
          tenantId, wid,
          PageAdvisorPromptSkills.toApiPayload(putStore, lww ? '' : (cloudRevisions[wid] || '')),
          newIdempotencyKey(),
        );
        const rec = PageAdvisorPromptSkills.mergeWorkspaceBundle(store, saved, wid, legacyWorkspaceId);
        store = rec.store;
        const rev = String(saved?.revision || '').trim();
        if (rev) cloudRevisions[wid] = rev;
      } catch (e) {
        if (e?.status === 409) {
          pendingConflict = e?.body?.current || { skills: [], active_skill_id: '' };
          pendingConflictWorkspaceId = wid;
          renderConflict();
          statusText(tx('paSkillConflictTitle'));
          return { ok: false, conflict: true };
        }
        const tid = e?.traceId || '';
        if (tid && $('#popupSkillStatus')) {
          $('#popupSkillStatus').setAttribute('data-traceId', tid);
        }
        statusText(tid
          ? `${tx('paSkillSavedLocalCloudFailed')} (${tid})`
          : tx('paSkillSavedLocalCloudFailed'));
        ok = false;
      }
    }
    return { ok };
  }

  function clearConflict() {
    pendingConflict = null;
    pendingConflictWorkspaceId = '';
    renderConflict();
  }

  async function persist() {
    await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
    const before = JSON.stringify(store);
    const scope = await resolveSkillScope();
    try {
      const pushed = await pushWorkspaces(scope);
      if (pushed.conflict) return false;
      if (pushed.ok) clearConflict();
      if (JSON.stringify(store) !== before) {
        await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
      }
      return pushed.ok;
    } catch (e) {
      const tid = e?.traceId || '';
      statusText(tid
        ? `${tx('paSkillSavedLocalCloudFailed')} (${tid})`
        : tx('paSkillSavedLocalCloudFailed'));
      return false;
    }
  }

  async function resolveConflictKeepLocal() {
    if (saveBusy) return;
    saveBusy = true;
    try {
      if (pendingConflictWorkspaceId) lwwWorkspaceIds.add(pendingConflictWorkspaceId);
      clearConflict();
      const ok = await persist();
      if (ok) {
        renderList();
        statusText(tx('paSkillSaved'));
      }
    } catch (e) {
      statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      saveBusy = false;
    }
  }

  async function resolveConflictUseCloud() {
    if (saveBusy) return;
    saveBusy = true;
    try {
      const remote = pendingConflict || { skills: [], active_skill_id: '' };
      const wid = pendingConflictWorkspaceId;
      const scope = await resolveSkillScope();
      store = PageAdvisorPromptSkills.mergeWorkspaceBundle(
        store, remote, wid, scope?.workspaceId || '',
      ).store;
      cloudRevisions[wid] = String(remote?.revision || '').trim();
      clearConflict();
      await PageAdvisorPromptSkills.saveToStorage(
        store,
        typeof Storage !== 'undefined' ? Storage : null,
      );
      renderList();
      setEditorVisible(false);
      statusText(tx('paSkillSyncedPull'));
    } catch (e) {
      statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      saveBusy = false;
    }
  }

  function renderConflict() {
    const box = $('#popupSkillConflict');
    if (!box) return;
    box.style.display = pendingConflict ? 'block' : 'none';
  }

  async function applyActive(id) {
    store = PageAdvisorPromptSkills.setActive(store, id).store;
    await persist();
    renderList();
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
      await refreshLastWorkspace();
    } catch (e) {
      console.warn('[taskChromePlugin] load prompt skills:', e?.message || e);
    }
    try {
      if (typeof PageAdvisorAPI !== 'undefined' && typeof PageAdvisorAPI.getPromptSkills === 'function') {
        await refreshWorkspaceRows();
        const scope = await resolveSkillScope();
        const legacy = scope?.workspaceId || '';
        const wids = new Set(collectPushWorkspaceIds(legacy));
        if (legacy) wids.add(legacy);
        let needUpload = false;
        let didPull = false;
        for (const wid of wids) {
          const tenantId = tenantForWorkspace(wid) || (wid === legacy ? scope?.tenantId : '');
          if (!tenantId) continue;
          const remote = await PageAdvisorAPI.getPromptSkills(tenantId, wid);
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
      }
    } catch (e) {
      console.warn('[taskChromePlugin] sync prompt skills:', e?.message || e);
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

  async function deleteSkill(skillId) {
    const id = String(skillId || $('#popupSkillEditingId')?.value || '').trim();
    if (!id) return;
    store = PageAdvisorPromptSkills.removeSkill(store, id).store;
    const ok = await persist();
    setEditorVisible(false);
    renderList();
    if (ok) statusText(tx('paSkillDeleted'));
  }

  function bindEvents() {
    const toggle = skillToggleBtn();
    const ui = Ui();
    // Anti-Replay-OK: ui-only expand/collapse of skill management, no HTTP.
    if (toggle && ui) {
      toggle.addEventListener('click', () => {
        ui.toggleLlmSettingsExpanded(skillFields(), toggle);
      });
    }
    const save = $('#btnSkillSave');
    if (save) save.addEventListener('click', () => { saveSkill().catch(() => {}); });
    const neu = $('#btnSkillNew');
    // Anti-Replay-OK: ui-only empty editor, no HTTP until save.
    if (neu) neu.addEventListener('click', () => fillEditor(null));
    const clear = $('#btnSkillClearActive');
    if (clear) {
      clear.addEventListener('click', () => {
        applyActive('').catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      });
    }
    const keepLocal = $('#btnSkillConflictKeepLocal');
    if (keepLocal) {
      keepLocal.addEventListener('click', () => { resolveConflictKeepLocal().catch(() => {}); });
    }
    const useCloud = $('#btnSkillConflictUseCloud');
    if (useCloud) {
      useCloud.addEventListener('click', () => { resolveConflictUseCloud().catch(() => {}); });
    }
  }

  window.PopupPageAdvisorSkills = {
    loadSkills,
    setSkillSectionVisible,
    bindEvents,
    get scopeProvider() { return scopeProvider; },
    set scopeProvider(fn) { scopeProvider = fn; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
