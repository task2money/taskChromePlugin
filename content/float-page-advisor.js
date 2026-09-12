/**
 * Alt+E 页面优化建议 UI：多选列表 + 填入任务描述（不 createTask）。
 * 须在 float-boot / float-form 之后、content.js 之前注入。
 */

'use strict';

var pageAdvisorBusy = false;
var pageAdvisorConfirmGuard = (typeof ClickGuard !== 'undefined' && ClickGuard.createClickGuard)
  ? ClickGuard.createClickGuard({ debounceMs: 400 })
  : null;
var pageAdvisorState = {
  suggestions: [],
  pageUrl: '',
  jobId: '',
};

function ensurePageAdvisorModal() {
  let modal = document.getElementById('taskplugin-page-advisor-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'taskplugin-page-advisor-modal';
  modal.className = 'taskplugin-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="taskplugin-modal-card" role="dialog" aria-modal="true" aria-labelledby="taskplugin-page-advisor-title">
      <h4 id="taskplugin-page-advisor-title">页面优化建议</h4>
      <p class="taskplugin-modal-el" id="taskplugin-page-advisor-hint">多选后填入浮窗任务描述（不会自动创建任务）</p>
      <div id="taskplugin-page-advisor-list" class="taskplugin-page-advisor-list"></div>
      <div id="taskplugin-page-advisor-links" class="taskplugin-page-advisor-links" hidden></div>
      <div class="taskplugin-modal-actions">
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-cancel">取消</button>
        <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-page-advisor-confirm" aria-busy="false">填入任务描述</button>
      </div>
      <div id="taskplugin-page-advisor-error" class="taskplugin-result"></div>
    </div>
  `;
  if (root) {
    root.appendChild(modal);
  } else {
    document.body.appendChild(modal);
  }

  document.getElementById('taskplugin-page-advisor-cancel')?.addEventListener('click', () => {
    // Anti-Replay-OK: ui-only — 关闭建议浮层，无写接口
    closePageAdvisorModal();
  });

  document.getElementById('taskplugin-page-advisor-confirm')?.addEventListener('click', () => {
    void confirmPageAdvisorFill();
  });

  return modal;
}

function closePageAdvisorModal() {
  const modal = document.getElementById('taskplugin-page-advisor-modal');
  if (!modal) return;
  modal.hidden = true;
  pageAdvisorState = { suggestions: [], pageUrl: '', jobId: '' };
  const err = document.getElementById('taskplugin-page-advisor-error');
  if (err) {
    err.className = 'taskplugin-result';
    err.textContent = '';
    err.removeAttribute('data-traceId');
  }
  const links = document.getElementById('taskplugin-page-advisor-links');
  if (links) {
    links.hidden = true;
    links.innerHTML = '';
  }
  const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.setAttribute('aria-busy', 'false');
    confirmBtn.textContent = '填入任务描述';
  }
}

function setPageAdvisorError(msg, traceId) {
  const err = document.getElementById('taskplugin-page-advisor-error');
  if (!err) return;
  err.textContent = msg || '';
  err.className = msg
    ? 'taskplugin-result taskplugin-show taskplugin-result-error'
    : 'taskplugin-result';
  if (msg && traceId && typeof setDataTraceId === 'function') {
    setDataTraceId(err, traceId);
  } else {
    err.removeAttribute('data-traceId');
  }
}

function openFloatPanelForAdvisor() {
  if (typeof isOpen !== 'undefined' && !isOpen && panel && btn) {
    isOpen = true;
    panel.classList.add('taskplugin-open');
    btn.classList.add('taskplugin-active');
  }
}

function showPageAdvisorLoading(message) {
  const modal = ensurePageAdvisorModal();
  const list = document.getElementById('taskplugin-page-advisor-list');
  const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
  const links = document.getElementById('taskplugin-page-advisor-links');
  if (list) list.innerHTML = `<p class="taskplugin-page-advisor-loading">${esc(message || '生成中…')}</p>`;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-busy', 'true');
  }
  if (links) {
    links.hidden = true;
    links.innerHTML = '';
  }
  setPageAdvisorError('');
  openFloatPanelForAdvisor();
  modal.hidden = false;
}

function showPageAdvisorSuggestions(payload) {
  const modal = ensurePageAdvisorModal();
  const list = document.getElementById('taskplugin-page-advisor-list');
  const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
  const links = document.getElementById('taskplugin-page-advisor-links');
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  pageAdvisorState = {
    suggestions,
    pageUrl: String(payload?.pageUrl || ''),
    jobId: String(payload?.jobId || ''),
  };

  if (links) {
    links.hidden = true;
    links.innerHTML = '';
  }

  if (!suggestions.length) {
    if (list) list.innerHTML = '<p class="taskplugin-page-advisor-loading">未返回可用建议</p>';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-busy', 'false');
    }
  } else if (list) {
    list.innerHTML = suggestions.map((s, idx) => {
      const id = String(s.id != null ? s.id : `s${idx}`);
      const title = esc(s.title || '建议');
      const summary = esc(s.summary || s.detail || '');
      return `
        <label class="taskplugin-page-advisor-item">
          <input type="checkbox" class="taskplugin-page-advisor-check" value="${esc(id)}" data-order="${idx}" checked>
          <span class="taskplugin-page-advisor-item-body">
            <strong>${title}</strong>
            <span class="taskplugin-page-advisor-summary">${summary}</span>
          </span>
        </label>
      `;
    }).join('');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.setAttribute('aria-busy', 'false');
      confirmBtn.textContent = '填入任务描述';
    }
  }

  setPageAdvisorError('');
  openFloatPanelForAdvisor();
  modal.hidden = false;
}

function showPageAdvisorResourceError(payload) {
  const modal = ensurePageAdvisorModal();
  const list = document.getElementById('taskplugin-page-advisor-list');
  const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
  const links = document.getElementById('taskplugin-page-advisor-links');
  if (list) {
    list.innerHTML = `<p class="taskplugin-page-advisor-loading">${esc(payload?.message || '未配置智能体资源')}</p>`;
  }
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-busy', 'false');
  }
  if (links && Array.isArray(payload?.links)) {
    links.hidden = false;
    links.innerHTML = payload.links.map((l) => {
      const href = esc(l.href || '#');
      const label = esc(l.label || l.href || '');
      // Anti-Replay-OK: real <a href> navigation to settings — no write API
      return `<a class="taskplugin-page-advisor-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }).join('');
  }
  setPageAdvisorError(payload?.message || '', payload?.traceId);
  openFloatPanelForAdvisor();
  modal.hidden = false;
}

function collectSelectedSuggestionIds() {
  const checks = document.querySelectorAll('#taskplugin-page-advisor-list .taskplugin-page-advisor-check:checked');
  const ordered = Array.from(checks).sort((a, b) => {
    const ao = Number(a.getAttribute('data-order') || 0);
    const bo = Number(b.getAttribute('data-order') || 0);
    return ao - bo;
  });
  return ordered.map((el) => el.value);
}

async function confirmPageAdvisorFill() {
  const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
  const runFill = () => {
    const selectedIds = collectSelectedSuggestionIds();
    if (!selectedIds.length) {
      setPageAdvisorError('请至少勾选一条建议');
      return { filled: false };
    }
    const Fill = typeof PageAdvisorFill !== 'undefined' ? PageAdvisorFill : null;
    if (!Fill) {
      setPageAdvisorError('PageAdvisorFill 未加载');
      return { filled: false };
    }
    // 断言路径：仅改描述，绝不 createTask
    const next = Fill.appendSuggestionsToDescription(
      descInput ? descInput.value : '',
      pageAdvisorState.suggestions,
      selectedIds,
      pageAdvisorState.pageUrl,
    );
    if (descInput) {
      descInput.value = next;
      if (typeof syncDescResetButton === 'function') syncDescResetButton();
    }
    openFloatPanelForAdvisor();
    closePageAdvisorModal();
    if (typeof showResult === 'function') {
      showResult('已将优化建议填入任务描述（未自动创建任务）', 'success');
    }
    return { filled: true, createTaskCalled: false };
  };

  if (pageAdvisorConfirmGuard) {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-busy', 'true');
      confirmBtn.textContent = '填入中…';
    }
    try {
      const outcome = await pageAdvisorConfirmGuard.run(async () => runFill());
      if (outcome.skipped) return;
    } finally {
      if (confirmBtn && document.getElementById('taskplugin-page-advisor-modal')
          && !document.getElementById('taskplugin-page-advisor-modal').hidden) {
        confirmBtn.disabled = false;
        confirmBtn.setAttribute('aria-busy', 'false');
        confirmBtn.textContent = '填入任务描述';
      }
    }
    return;
  }

  // fallback busyRef
  if (pageAdvisorBusy) return;
  pageAdvisorBusy = true;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.setAttribute('aria-busy', 'true');
  }
  try {
    runFill();
  } finally {
    pageAdvisorBusy = false;
  }
}

/**
 * Content → SW：采集页面上下文 + 当前浮窗工作空间/租户。
 */
function getPageAdvisorContextFromFloat() {
  const Capture = typeof PageContext !== 'undefined' ? PageContext : null;
  const page = Capture
    ? Capture.capturePageContext()
    : {
      url: location.href,
      title: document.title,
      pageText: '',
      pageTextTruncated: false,
    };

  const workspaceId = (typeof wsSelect !== 'undefined' && wsSelect?.value)
    ? String(wsSelect.value).trim()
    : '';
  let companyId = '';
  if (workspaceId && typeof workspacesData !== 'undefined' && Array.isArray(workspacesData)) {
    const ws = workspacesData.find((w) => String(w.id || w._id) === workspaceId);
    companyId = String(ws?.company_id || ws?.companyId || '').trim();
  }

  return {
    success: true,
    data: {
      url: page.url,
      title: page.title,
      pageText: page.pageText,
      pageTextTruncated: page.pageTextTruncated,
      workspaceId,
      companyId,
      tenantId: companyId,
    },
  };
}

function handlePageAdvisorResultMessage(msg) {
  if (msg.phase === 'loading') {
    showPageAdvisorLoading(msg.message || '生成中…');
    return;
  }
  if (!msg.ok) {
    if (msg.errorCode === 'AGENT_RESOURCE_NOT_CONFIGURED' || msg.links) {
      showPageAdvisorResourceError(msg);
      return;
    }
    ensurePageAdvisorModal();
    showPageAdvisorLoading('');
    const list = document.getElementById('taskplugin-page-advisor-list');
    if (list) list.innerHTML = '';
    setPageAdvisorError(msg.error || '页面优化建议失败', msg.traceId);
    openFloatPanelForAdvisor();
    const modal = document.getElementById('taskplugin-page-advisor-modal');
    if (modal) modal.hidden = false;
    const confirmBtn = document.getElementById('taskplugin-page-advisor-confirm');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-busy', 'false');
    }
    return;
  }
  if (msg.phase === 'done' || Array.isArray(msg.suggestions)) {
    showPageAdvisorSuggestions(msg);
  }
}
