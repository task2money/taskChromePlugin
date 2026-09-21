/** Popup：提示词 Skill CRUD + 登录后 SaaS 同步。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  let store = { skills: [], activeSkillId: '' };
  let saveBusy = false;

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
      return;
    }
    await PageAdvisorAPI.putPromptSkills(
      PageAdvisorPromptSkills.toApiPayload(st),
      newIdempotencyKey(),
    );
  }

  async function persist() {
    await PageAdvisorPromptSkills.saveToStorage(store, typeof Storage !== 'undefined' ? Storage : null);
    try {
      await pushCloud(store);
      return true;
    } catch (e) {
      const tid = e?.traceId || '';
      statusText(tid
        ? `${tx('paSkillSavedLocalCloudFailed')} (${tid})`
        : tx('paSkillSavedLocalCloudFailed'));
      return false;
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
        const remote = await PageAdvisorAPI.getPromptSkills();
        const rec = PageAdvisorPromptSkills.reconcileCloud(store, remote);
        store = rec.store;
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
  }

  window.PopupPageAdvisorSkills = {
    loadSkills,
    setSkillSectionVisible,
    bindEvents,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }
})();
