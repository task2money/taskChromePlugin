/** Popup Skill 列表/下拉渲染（无 HTTP）。 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function workspaceLabelOf(workspaceRows, workspaceId) {
    const wid = String(workspaceId || '').trim();
    const ws = (workspaceRows || []).find((row) => String(row?.id || row?._id || '') === wid);
    if (!ws) return wid;
    const labels = (typeof WorkspaceList !== 'undefined' && WorkspaceList.workspaceOptionLabels)
      ? WorkspaceList.workspaceOptionLabels([ws])
      : [ws.name || wid];
    return labels[0] || wid;
  }

  function fillSyncTargetSelect(selectEl, selected, workspaceRows, syncLocal) {
    if (!selectEl) return;
    const want = String(selected || syncLocal);
    const opts = [`<option value="${escapeHtml(syncLocal)}">${escapeHtml(tx('paSkillSyncLocal'))}</option>`];
    (workspaceRows || []).forEach((row) => {
      const id = String(row?.id || row?._id || '').trim();
      if (!id) return;
      opts.push(`<option value="${escapeHtml(id)}">${escapeHtml(workspaceLabelOf(workspaceRows, id))}</option>`);
    });
    if (want && want !== syncLocal && !opts.some((html) => html.includes(`value="${escapeHtml(want)}"`))) {
      opts.push(`<option value="${escapeHtml(want)}">${escapeHtml(want)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
    if ([...selectEl.options].some((o) => o.value === want)) {
      selectEl.value = want;
    } else {
      selectEl.value = syncLocal;
    }
  }

  function renderActiveSummary(el, store) {
    if (!el) return;
    const active = typeof PageAdvisorPromptSkills !== 'undefined'
      ? PageAdvisorPromptSkills.getActive(store)
      : null;
    el.textContent = active
      ? `${tx('paSkillActive')}: ${active.title}`
      : tx('paSkillNoneActive');
  }

  function renderSkillList(root, store, syncLocal, workspaceRows, handlers) {
    if (!root) return;
    root.replaceChildren();
    (store.skills || []).forEach((sk) => {
      const id = `popupSkillRadio_${sk.id}`;
      const row = document.createElement('div');
      row.className = 'popup-skill-row';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'popupSkillActive';
      radio.id = id;
      radio.value = sk.id;
      radio.checked = store.activeSkillId === sk.id;
      radio.addEventListener('change', () => handlers.onActive(sk.id));
      const span = document.createElement('span');
      span.textContent = `${sk.title}${store.activeSkillId === sk.id ? ` (${tx('paSkillActive')})` : ''}`;
      const dest = document.createElement('select');
      dest.className = 'form-select popup-skill-sync';
      dest.setAttribute('aria-label', tx('paSkillSyncTarget'));
      fillSyncTargetSelect(dest, sk.syncTarget || syncLocal, workspaceRows, syncLocal);
      dest.addEventListener('change', (ev) => {
        ev.stopPropagation();
        handlers.onTarget(sk.id, dest.value);
      });
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-sm';
      edit.textContent = tx('paSkillEdit');
      // Anti-Replay-OK: ui-only reveal of editor, no HTTP.
      edit.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.onEdit(sk);
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-sm';
      del.textContent = tx('paSkillDelete');
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handlers.onDelete(sk.id);
      });
      row.appendChild(radio);
      row.appendChild(span);
      row.appendChild(dest);
      row.appendChild(edit);
      row.appendChild(del);
      root.appendChild(row);
    });
  }

  const PopupPromptSkillUi = {
    escapeHtml,
    workspaceLabelOf,
    fillSyncTargetSelect,
    renderActiveSummary,
    renderSkillList,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupPromptSkillUi;
  }
  if (global) global.PopupPromptSkillUi = PopupPromptSkillUi;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
