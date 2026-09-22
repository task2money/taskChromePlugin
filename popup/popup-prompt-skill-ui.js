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

  function skillIsSystem(sk, ctx) {
    if (typeof PageAdvisorPromptSkills !== 'undefined' && typeof PageAdvisorPromptSkills.isSystemPromptSkill === 'function') {
      return PageAdvisorPromptSkills.isSystemPromptSkill(sk, ctx && ctx.systemSkillIds);
    }
    return Boolean(sk && sk.readonly);
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

  function fillTendencyDatalist(listEl, skills) {
    if (!listEl) return;
    const suggested = (typeof PageAdvisorPromptSkills !== 'undefined' && PageAdvisorPromptSkills.TENDENCIES)
      ? PageAdvisorPromptSkills.TENDENCIES
      : ['a11y', 'conversion', 'perf', 'seo', 'custom'];
    const i18nKey = {
      a11y: 'paSkillTendencyA11y',
      conversion: 'paSkillTendencyConversion',
      perf: 'paSkillTendencyPerf',
      seo: 'paSkillTendencySeo',
      custom: 'paSkillTendencyCustom',
    };
    const seen = new Set();
    const opts = [];
    suggested.forEach((value) => {
      seen.add(value);
      const label = i18nKey[value] && typeof tx === 'function' ? tx(i18nKey[value]) : value;
      opts.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
    });
    (skills || []).forEach((sk) => {
      const value = String(sk && sk.tendency ? sk.tendency : '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      opts.push(`<option value="${escapeHtml(value)}"></option>`);
    });
    listEl.innerHTML = opts.join('');
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

  function appendTitleLine(row, radio, labelText) {
    const title = document.createElement('div');
    title.className = 'popup-skill-row-title';
    const span = document.createElement('span');
    span.textContent = labelText;
    title.appendChild(radio);
    title.appendChild(span);
    row.appendChild(title);
    return title;
  }

  function tenantIdOf(workspaceRows, workspaceId) {
    const wid = String(workspaceId || '').trim();
    const ws = (workspaceRows || []).find((row) => String((row && (row.id || row._id)) || '') === wid);
    return String((ws && (ws.company_id || ws.companyId)) || '').trim();
  }

  function appendSaasLink(titleEl, skill, workspaceRows, ctx, handlers) {
    const Skills = globalThis.PageAdvisorPromptSkills;
    const link = document.createElement('a');
    link.className = 'btn btn-sm popup-skill-saas-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = tx('paSkillOpenWorkspacePage');
    link.setAttribute('aria-label', tx('paSkillOpenWorkspacePageAria'));
    const lastWs = ctx && ctx.lastWorkspaceId;
    const wid = Skills
      ? Skills.workspaceIdForSkill(skill, lastWs)
      : String((skill && skill.syncTarget && skill.syncTarget !== 'local' ? skill.syncTarget : lastWs) || '').trim();
    const href = Skills
      ? Skills.buildPromptSkillsPageHref({
        baseUrl: ctx && ctx.baseUrl,
        tenantId: tenantIdOf(workspaceRows, wid),
        workspaceId: wid,
      })
      : '';
    if (href) {
      link.href = href;
      // Anti-Replay-OK: real <a href> navigation to SaaS page, no write API.
    } else {
      link.href = '#';
      link.setAttribute('aria-disabled', 'true');
      link.title = tx('paSkillNeedWorkspace');
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (handlers && handlers.onMissingWorkspace) handlers.onMissingWorkspace();
      });
    }
    titleEl.appendChild(link);
  }

  function makeActiveRadio(id, value, checked, onChange) {
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'popupSkillActive';
    radio.id = id;
    radio.value = value;
    radio.checked = checked;
    radio.addEventListener('change', onChange);
    return radio;
  }

  function renderNoneRow(root, store, handlers) {
    const row = document.createElement('div');
    row.className = 'popup-skill-row popup-skill-row-none';
    const radio = makeActiveRadio(
      'popupSkillRadio_none',
      '',
      !store.activeSkillId,
      () => handlers.onActive(''),
    );
    appendTitleLine(row, radio, tx('paSkillClearActive'));
    root.appendChild(row);
  }

  function renderSkillList(root, store, syncLocal, workspaceRows, handlers, ctx) {
    if (!root) return;
    root.replaceChildren();
    renderNoneRow(root, store, handlers);
    (store.skills || []).forEach((sk) => {
      const row = document.createElement('div');
      row.className = 'popup-skill-row';
      const radio = makeActiveRadio(
        `popupSkillRadio_${sk.id}`,
        sk.id,
        store.activeSkillId === sk.id,
        () => handlers.onActive(sk.id),
      );
      const label = `${sk.title}${store.activeSkillId === sk.id ? ` (${tx('paSkillActive')})` : ''}`;
      const titleEl = appendTitleLine(row, radio, label);
      appendSaasLink(titleEl, sk, workspaceRows, ctx || {}, handlers || {});
      const dest = document.createElement('select');
      dest.className = 'form-select popup-skill-sync';
      dest.setAttribute('aria-label', tx('paSkillSyncTarget'));
      fillSyncTargetSelect(dest, sk.syncTarget || syncLocal, workspaceRows, syncLocal);
      const system = skillIsSystem(sk, ctx);
      dest.disabled = system;
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
      const actions = document.createElement('div');
      actions.className = 'popup-skill-row-actions';
      actions.appendChild(dest);
      actions.appendChild(edit);
      if (!system) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-sm';
        del.textContent = tx('paSkillDelete');
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          handlers.onDelete(sk);
        });
        actions.appendChild(del);
      } else {
        const badge = document.createElement('span');
        badge.className = 'popup-skill-system-badge';
        badge.textContent = tx('paSkillSystemBadge');
        titleEl.appendChild(badge);
      }
      row.appendChild(actions);
      root.appendChild(row);
    });
  }

  function setEditorVisible(open) {
    const el = document.querySelector('#popupSkillEditor');
    if (!el) return;
    el.style.display = open ? 'block' : 'none';
    el.hidden = !open;
  }

  function fillEditor(skill, store, defaultSyncTarget, workspaceRows, syncLocal) {
    const q = (id) => document.querySelector(id);
    q('#popupSkillEditingId').value = skill?.id || '';
    q('#popupSkillTitle').value = skill?.title || '';
    q('#popupSkillTendency').value = skill?.tendency || 'custom';
    fillTendencyDatalist(q('#popupSkillTendencyList'), store && store.skills);
    q('#popupSkillBody').value = skill?.body || '';
    fillSyncTargetSelect(q('#popupSkillSyncTarget'), skill?.syncTarget || defaultSyncTarget, workspaceRows, syncLocal);
    const ro = skillIsSystem(skill, { systemSkillIds: [] });
    ['#popupSkillTitle', '#popupSkillTendency', '#popupSkillBody', '#popupSkillSyncTarget'].forEach((sel) => {
      const el = q(sel);
      if (el) el.disabled = Boolean(skill?.readonly) || ro;
    });
    setEditorVisible(true);
  }

  const PopupPromptSkillUi = {
    escapeHtml,
    workspaceLabelOf,
    fillSyncTargetSelect,
    fillTendencyDatalist,
    renderActiveSummary,
    renderSkillList,
    setEditorVisible,
    fillEditor,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupPromptSkillUi;
  }
  if (global) global.PopupPromptSkillUi = PopupPromptSkillUi;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
