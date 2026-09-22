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
      const label = document.createElement('label');
      label.className = 'popup-skill-row';
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
      label.appendChild(radio);
      label.appendChild(span);
      label.appendChild(dest);
      label.addEventListener('click', (ev) => {
        if (ev.target === radio || ev.target === dest) return;
        handlers.onEdit(sk);
      });
      root.appendChild(label);
    });
  }

  function renderRevisions(root, revisionItems, currentRev, onRestore) {
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
      meta.textContent = parts.join(' · ');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      if (rev === currentRev) {
        btn.disabled = true;
        btn.textContent = tx('paSkillHistoryCurrent');
      } else {
        btn.textContent = tx('paSkillHistoryRestore');
        btn.addEventListener('click', () => { onRestore(rev); });
      }
      row.appendChild(meta);
      row.appendChild(btn);
      root.appendChild(row);
    });
  }

  const PopupPromptSkillUi = {
    escapeHtml,
    workspaceLabelOf,
    fillSyncTargetSelect,
    renderActiveSummary,
    renderSkillList,
    renderRevisions,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupPromptSkillUi;
  }
  if (global) global.PopupPromptSkillUi = PopupPromptSkillUi;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
