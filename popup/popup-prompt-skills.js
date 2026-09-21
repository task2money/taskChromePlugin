/** Popup：提示词 Skill CRUD + 登录后 SaaS 同步。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  let store = { skills: [], activeSkillId: '' };
  let saveBusy = false;
  // OPT-20260922-003: 云端当前版本（GET/PUT 回传），PUT 时作为 base_revision 做 CAS。
  let cloudRevision = '';
  // 409 时挂起的冲突：云端文档，供用户选择保留本机或云端。
  let pendingConflict = null;
  let scopeProvider = null;

  async function resolveSkillScope() {
    if (typeof scopeProvider === 'function') {
      return scopeProvider();
    }
    const wsEl = typeof document !== 'undefined' ? document.querySelector('#popupDefaultWorkspace') : null;
    let workspaceId = String(wsEl?.value || '').trim();
    if (!workspaceId && typeof Storage !== 'undefined' && typeof Storage.getLastWorkspace === 'function') {
      workspaceId = String(await Storage.getLastWorkspace() || '').trim();
    }
    if (!workspaceId) return null;
    if (typeof sendMessageWithTimeout !== 'function') return null;
    const r = await sendMessageWithTimeout({ action: 'getWorkspaces' }, 12000);
    const data = r?.data;
    const rows = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
    const ws = (rows || []).find((row) => String(row?.id || row?._id || '') === workspaceId);
    const tenantId = String(ws?.company_id || ws?.companyId || '').trim();
    if (!tenantId) return null;
    return { tenantId, workspaceId };
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
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `psk_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  }

  function fillEditor(skill) {
    $('#popupSkillEditingId').value = skill?.id || '';
    $('#popupSkillTitle').value = skill?.title || '';
    $('#popupSkillTendency').value = skill?.tendency || 'custom';
    $('#popupSkillBody').value = skill?.body || '';
  }

  function renderList() {
    const root = $('#popupSkillList');
    if (!root) return;
    root.replaceChildren();
    store.skills.forEach((sk) => {
      const id = `popupSkillRadio_${sk.id}`;
      const label = document.createElement('label');
      label.className = 'popup-skill-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'popupSkillActive';
      radio.id = id;
      radio.value = sk.id;
      radio.checked = store.activeSkillId === sk.id;
      radio.addEventListener('change', () => {
        applyActive(sk.id).catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      });
      const span = document.createElement('span');
      span.textContent = `${sk.title}${store.activeSkillId === sk.id ? ` (${tx('paSkillActive')})` : ''}`;
      label.appendChild(radio);
      label.appendChild(span);
      label.addEventListener('click', (ev) => {
        if (ev.target === radio) return;
        fillEditor(sk);
      });
      root.appendChild(label);
    });
  }

  async function pushCloud(st) {
    if (typeof PageAdvisorAPI === 'undefined' || typeof PageAdvisorAPI.putPromptSkills !== 'function') {
      return null;
    }
    const scope = await resolveSkillScope();
    if (!scope) {
      statusText(tx('paSkillNeedWorkspace'));
      return null;
    }
    const saved = await PageAdvisorAPI.putPromptSkills(
      scope.tenantId,
      scope.workspaceId,
      PageAdvisorPromptSkills.toApiPayload(st, cloudRevision),
      newIdempotencyKey(),
    );
    // 服务端回传写入后的新版本，作为下次 PUT 的 base_revision。
    const rev = String(saved?.revision || '').trim();
    if (rev) cloudRevision = rev;
    return saved;
  }

  function clearConflict() {
    pendingConflict = null;
    renderConflict();
  }

  async function persist() {
    await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
    try {
      await pushCloud(store);
      clearConflict();
      return true;
    } catch (e) {
      // 409：另一端已改。本机内容已存本机，交给用户决定保留哪一份。
      if (e?.status === 409) {
        pendingConflict = e?.body?.current || { skills: [], active_skill_id: '' };
        renderConflict();
        statusText(tx('paSkillConflictTitle'));
        return false;
      }
      const tid = e?.traceId || '';
      statusText(tid
        ? `${tx('paSkillSavedLocalCloudFailed')} (${tid})`
        : tx('paSkillSavedLocalCloudFailed'));
      return false;
    }
  }

  /** 保留本机：以本机内容覆盖云端（此时不带 base_revision，等价用户确认的 LWW）。 */
  async function resolveConflictKeepLocal() {
    if (saveBusy) return;
    saveBusy = true;
    try {
      cloudRevision = '';
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

  /** 使用云端：采纳 409 回传的云端文档并落本机。 */
  async function resolveConflictUseCloud() {
    if (saveBusy) return;
    saveBusy = true;
    try {
      const remote = pendingConflict || { skills: [], active_skill_id: '' };
      store = PageAdvisorPromptSkills.fromApiPayload(remote);
      cloudRevision = String(remote?.revision || '').trim();
      clearConflict();
      await PageAdvisorPromptSkills.saveToStorage(
        store,
        typeof Storage !== 'undefined' ? Storage : null,
      );
      renderList();
      fillEditor(PageAdvisorPromptSkills.getActive(store) || store.skills[0] || null);
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

  async function loadSkills() {
    if (typeof PageAdvisorPromptSkills === 'undefined') return;
    setSkillSectionVisible(true);
    try {
      store = await PageAdvisorPromptSkills.loadFromStorage(
        typeof Storage !== 'undefined' ? Storage : null,
      );
    } catch (e) {
      console.warn('[taskChromePlugin] load prompt skills:', e?.message || e);
    }
    try {
      if (typeof PageAdvisorAPI !== 'undefined' && typeof PageAdvisorAPI.getPromptSkills === 'function') {
        const scope = await resolveSkillScope();
        if (!scope) {
          statusText(tx('paSkillNeedWorkspace'));
        } else {
          const remote = await PageAdvisorAPI.getPromptSkills(scope.tenantId, scope.workspaceId);
          const rec = PageAdvisorPromptSkills.reconcileCloud(store, remote);
          store = rec.store;
          cloudRevision = rec.revision || '';
          if (rec.action === 'upload') {
            await persist();
            statusText(tx('paSkillSyncedUpload'));
          } else if (rec.action === 'pull') {
            await PageAdvisorPromptSkills.saveToStorage(
              store,
              typeof Storage !== 'undefined' ? Storage : null,
            );
            statusText(tx('paSkillSyncedPull'));
          }
        }
      }
    } catch (e) {
      console.warn('[taskChromePlugin] sync prompt skills:', e?.message || e);
    }
    renderList();
    const active = PageAdvisorPromptSkills.getActive(store);
    fillEditor(active || store.skills[0] || null);
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
    try {
      const editingId = $('#popupSkillEditingId')?.value || '';
      const result = PageAdvisorPromptSkills.upsertSkill(store, {
        id: editingId,
        title: $('#popupSkillTitle')?.value || '',
        tendency: $('#popupSkillTendency')?.value || 'custom',
        body: $('#popupSkillBody')?.value || '',
      });
      store = result.store;
      if (!store.activeSkillId) {
        store = PageAdvisorPromptSkills.setActive(store, result.skill.id).store;
      }
      const ok = await persist();
      fillEditor(result.skill);
      renderList();
      if (ok) statusText(tx('paSkillSaved'));
    } catch (e) {
      statusText(e?.message || tx('popupSaveFailed'));
    } finally {
      saveBusy = false;
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
      }
    }
  }

  async function deleteSkill() {
    const id = $('#popupSkillEditingId')?.value || '';
    if (!id) return;
    store = PageAdvisorPromptSkills.removeSkill(store, id).store;
    const ok = await persist();
    fillEditor(null);
    renderList();
    if (ok) statusText(tx('paSkillDeleted'));
  }

  function bindEvents() {
    const save = $('#btnSkillSave');
    if (save) save.addEventListener('click', () => { saveSkill().catch(() => {}); });
    const neu = $('#btnSkillNew');
    if (neu) neu.addEventListener('click', () => fillEditor(null));
    const del = $('#btnSkillDelete');
    if (del) del.addEventListener('click', () => { deleteSkill().catch(() => {}); });
    const clear = $('#btnSkillClearActive');
    if (clear) {
      clear.addEventListener('click', () => {
        applyActive('').catch((e) => statusText(e?.message || tx('popupSaveFailed')));
      });
    }
    // OPT-20260922-003: 冲突二选一
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
