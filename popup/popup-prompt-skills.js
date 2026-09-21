/** Popup：提示词 Skill CRUD + 登录后 SaaS 同步。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  let store = { skills: [], activeSkillId: '' };
  let saveBusy = false;
  // OPT-20260922-003: 云端当前版本（GET/PUT 回传），PUT 时作为 base_revision 做 CAS。
  let cloudRevision = '';
  // 409 时挂起的冲突：云端文档，供用户选择保留本机或云端。
  let pendingConflict = null;
  // OPT-20260922-004: 云端修订列表（最新在前），供覆盖后回滚。
  let revisionItems = [];
  let revisionLoaded = false;
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

  /**
   * 采纳服务端回传的正文（OPT-20260922-005）。
   *
   * 服务端会把本次提交与远端按 skill_id 三方合并后落库（改的是不同 skill 时不再 409），
   * 回传的 revision 因此对应的是**合并后**的正文。本机若只更新 revision、正文仍留着
   * 旧的一份，下次保存就会带着合并后的 revision 提交旧正文 —— 合并进来的同事那半边
   * 改动会被当成「本机的改动」又改回去，静默丢失。故成功落库后一律以服务端为准。
   *
   * @returns {boolean} 本机正文是否被改写（调用方据此重渲染）。
   */
  function adoptServerBundle(saved) {
    if (!saved || typeof saved !== 'object') return false;
    const remote = PageAdvisorPromptSkills.fromApiPayload(saved);
    const before = JSON.stringify(PageAdvisorPromptSkills.toApiPayload(store));
    const after = JSON.stringify(PageAdvisorPromptSkills.toApiPayload(remote));
    if (before === after) return false;
    store = remote;
    return true;
  }

  async function persist() {
    await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
    try {
      const saved = await pushCloud(store);
      if (adoptServerBundle(saved)) {
        // 采纳后的正文也是本机正文，落盘保持与云端一致。
        await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
      }
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

  /** 修订列表：每行一个版本号摘要 + 回滚按钮，当前版本只做标记不可点。 */
  function renderRevisions() {
    const root = $('#popupSkillRevisions');
    if (!root) return;
    root.replaceChildren();
    if (!revisionItems.length) {
      const empty = document.createElement('p');
      empty.className = 'float-ball-hint';
      empty.textContent = tx('paSkillHistoryEmpty');
      root.appendChild(empty);
      return;
    }
    revisionItems.forEach((item) => {
      const rev = String(item?.revision || '').trim();
      if (!rev) return;
      const row = document.createElement('div');
      row.className = 'popup-skill-revision-row';
      const meta = document.createElement('span');
      const parts = [rev.slice(0, 8)];
      const when = String(item?.created_at || '').trim();
      if (when) parts.push(when);
      const count = Number(item?.skill_count);
      if (Number.isFinite(count)) parts.push(String(count));
      const actor = String(item?.actor_user_id || '').trim();
      if (actor) parts.push(actor);
      meta.textContent = parts.join(' · ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.value = rev;
      if (rev === cloudRevision) {
        btn.disabled = true;
        btn.textContent = tx('paSkillHistoryCurrent');
      } else {
        btn.textContent = tx('paSkillHistoryRestore');
        btn.addEventListener('click', () => { restoreRevision(rev).catch(() => {}); });
      }
      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    });
  }

  async function loadRevisions() {
    if (typeof PageAdvisorAPI === 'undefined'
      || typeof PageAdvisorAPI.listPromptSkillRevisions !== 'function') {
      return;
    }
    const scope = await resolveSkillScope();
    if (!scope) {
      statusText(tx('paSkillNeedWorkspace'));
      return;
    }
    try {
      revisionItems = await PageAdvisorAPI.listPromptSkillRevisions(scope.tenantId, scope.workspaceId);
      revisionLoaded = true;
    } catch (e) {
      statusText(tx('paSkillHistoryFailed'));
      return;
    }
    renderRevisions();
  }

  /** 回滚：服务端按 base_revision 做 CAS，成功后采纳返回的正文并刷新本机。 */
  async function restoreRevision(revision) {
    if (saveBusy) return;
    if (typeof PageAdvisorAPI === 'undefined'
      || typeof PageAdvisorAPI.restorePromptSkillRevision !== 'function') {
      return;
    }
    saveBusy = true;
    try {
      const scope = await resolveSkillScope();
      if (!scope) {
        statusText(tx('paSkillNeedWorkspace'));
        return;
      }
      const saved = await PageAdvisorAPI.restorePromptSkillRevision(
        scope.tenantId,
        scope.workspaceId,
        revision,
        cloudRevision,
        newIdempotencyKey(),
      );
      store = PageAdvisorPromptSkills.fromApiPayload(saved);
      cloudRevision = String(saved?.revision || '').trim();
      clearConflict();
      await PageAdvisorPromptSkills.saveToStorage(
        store,
        typeof Storage !== 'undefined' ? Storage : null,
      );
      renderList();
      fillEditor(PageAdvisorPromptSkills.getActive(store) || store.skills[0] || null);
      statusText(tx('paSkillHistoryRestored'));
    } catch (e) {
      // 回滚同样可能撞上并发编辑：复用冲突二选一面板。
      if (e?.status === 409) {
        pendingConflict = e?.body?.current || { skills: [], active_skill_id: '' };
        renderConflict();
        statusText(tx('paSkillConflictTitle'));
        return;
      }
      statusText(e?.message || tx('paSkillHistoryFailed'));
    } finally {
      saveBusy = false;
      if (revisionLoaded) {
        await loadRevisions().catch(() => {});
      }
    }
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
      // 服务端可能已把正文换成合并结果，故按 id 从 store 回读，而不是用本地旧对象。
      const shown = store.skills.find((s) => s.id === result.skill.id)
        || PageAdvisorPromptSkills.getActive(store)
        || store.skills[0]
        || result.skill;
      fillEditor(shown);
      renderList();
      if (ok) {
        statusText(tx('paSkillSaved'));
        // 已打开历史面板时同步刷新，让新版本立刻可回滚。
        if (revisionLoaded) await loadRevisions().catch(() => {});
      }
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
    // OPT-20260922-004: 修订历史按需拉取，避免每次开弹窗都多打一次网络。
    const historyLoad = $('#btnSkillHistoryLoad');
    if (historyLoad) {
      historyLoad.addEventListener('click', () => { loadRevisions().catch(() => {}); });
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
