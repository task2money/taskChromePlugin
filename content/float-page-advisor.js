/**
 * Alt+E 页面优化建议 UI：锚定悬浮卡 + 可逆 DOM 预览 + 全部/逐条填入。
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
var pageAdvisorPreviewSession = null;
var pageAdvisorLayoutRaf = 0;

function getPageAdvisorPreviewSession() {
  if (pageAdvisorPreviewSession) return pageAdvisorPreviewSession;
  const Preview = typeof PageAdvisorPreview !== 'undefined' ? PageAdvisorPreview : null;
  if (!Preview) return null;
  pageAdvisorPreviewSession = Preview.createPreviewSession({
    document,
    resolveNid: (nid) => {
      const id = String(nid || '').replace(/"/g, '');
      return document.querySelector(`[data-taskplugin-nid="${id}"]`);
    },
  });
  return pageAdvisorPreviewSession;
}

function ensurePageAdvisorLayer() {
  let layer = document.getElementById('taskplugin-page-advisor-layer');
  if (layer) return layer;

  layer = document.createElement('div');
  layer.id = 'taskplugin-page-advisor-layer';
  layer.hidden = true;
  layer.innerHTML = `
    <div id="taskplugin-page-advisor-cards" class="taskplugin-page-advisor-cards"></div>
    <div id="taskplugin-page-advisor-toolbar" class="taskplugin-page-advisor-toolbar" role="toolbar" aria-label="页面优化建议操作">
      <p class="taskplugin-page-advisor-toolbar-hint" id="taskplugin-page-advisor-hint">勾选即预览；填入任务描述不会自动创建任务</p>
      <div class="taskplugin-page-advisor-toolbar-actions">
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-cancel">关闭并还原</button>
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-retry" hidden>重试</button>
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-fill-one" disabled aria-busy="false">逐条填入</button>
        <button type="button" class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-page-advisor-fill-all" disabled aria-busy="false">全部填入</button>
      </div>
      <div id="taskplugin-page-advisor-links" class="taskplugin-page-advisor-links" hidden></div>
      <div id="taskplugin-page-advisor-error" class="taskplugin-result"></div>
    </div>
  `;
  if (root) root.appendChild(layer);
  else document.body.appendChild(layer);

  document.getElementById('taskplugin-page-advisor-cancel')?.addEventListener('click', () => {
    // Anti-Replay-OK: ui-only — 关闭建议层并还原预览
    closePageAdvisorModal();
  });
  document.getElementById('taskplugin-page-advisor-fill-all')?.addEventListener('click', () => {
    void confirmPageAdvisorFill({ mode: 'all' });
  });
  document.getElementById('taskplugin-page-advisor-fill-one')?.addEventListener('click', () => {
    void confirmPageAdvisorFill({ mode: 'one' });
  });
  document.getElementById('taskplugin-page-advisor-retry')?.addEventListener('click', () => {
    // Anti-Replay-OK: re-triggers Alt+E flow via runtime message
    const retryBtn = document.getElementById('taskplugin-page-advisor-retry');
    if (retryBtn) retryBtn.hidden = true;
    setPageAdvisorError('');
    showPageAdvisorLoading('正在采集页面并生成优化建议…');
    try {
      chrome.runtime.sendMessage({ action: 'pageOptimizationSuggest' }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      setPageAdvisorError(e?.message || '重试失败');
    }
  });

  window.addEventListener('scroll', schedulePageAdvisorLayout, true);
  window.addEventListener('resize', schedulePageAdvisorLayout);

  return layer;
}

function schedulePageAdvisorLayout() {
  if (pageAdvisorLayoutRaf) return;
  pageAdvisorLayoutRaf = requestAnimationFrame(() => {
    pageAdvisorLayoutRaf = 0;
    layoutPageAdvisorCards();
  });
}

function closePageAdvisorModal() {
  stopPageAdvisorDomWatcher();
  const Trap = typeof DialogFocusTrap !== 'undefined' ? DialogFocusTrap : null;
  const layer = document.getElementById('taskplugin-page-advisor-layer');
  if (Trap && layer && Trap.isFocusTrapActiveFor(layer)) {
    Trap.deactivateFocusTrap({ restoreFocus: false });
  }
  if (layer) layer.hidden = true;
  const session = getPageAdvisorPreviewSession();
  session?.undoAll();
  if (typeof PageContext !== 'undefined' && PageContext.clearDomNids) {
    PageContext.clearDomNids(document);
  }
  pageAdvisorState = { suggestions: [], pageUrl: '', jobId: '' };
  const cards = document.getElementById('taskplugin-page-advisor-cards');
  if (cards) cards.innerHTML = '';
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
  syncPageAdvisorFillButtons();
  if (typeof btn !== 'undefined' && btn && typeof btn.focus === 'function') btn.focus();
  if (typeof syncFloatPanelFocusTrap === 'function') syncFloatPanelFocusTrap();
}

function setPageAdvisorError(msg, traceId) {
  const err = document.getElementById('taskplugin-page-advisor-error');
  if (!err) return;
  err.textContent = msg || '';
  err.className = msg
    ? 'taskplugin-result taskplugin-show taskplugin-result-error'
    : 'taskplugin-result';
  if (msg) {
    err.setAttribute('role', 'alert');
    err.setAttribute('aria-live', 'assertive');
  } else {
    err.removeAttribute('role');
    err.removeAttribute('aria-live');
  }
  if (msg && traceId && typeof setDataTraceId === 'function') {
    setDataTraceId(err, traceId);
  } else if (msg && traceId) {
    err.setAttribute('data-traceId', String(traceId));
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
  const layer = ensurePageAdvisorLayer();
  const cards = document.getElementById('taskplugin-page-advisor-cards');
  if (cards) {
    cards.innerHTML = `<div class="taskplugin-page-advisor-status-card" role="status" aria-live="polite">${esc(message || '生成中…')}</div>`;
  }
  syncPageAdvisorFillButtons();
  const links = document.getElementById('taskplugin-page-advisor-links');
  if (links) {
    links.hidden = true;
    links.innerHTML = '';
  }
  setPageAdvisorError('');
  openFloatPanelForAdvisor();
  layer.hidden = false;
  showPageAdvisorLayer();
}

function resolveSuggestionAnchor(suggestion) {
  const nid = String(suggestion?.target_nid || '').trim();
  if (nid) {
    try {
      const el = document.querySelector(`[data-taskplugin-nid="${nid.replace(/"/g, '')}"]`);
      if (el) return el;
    } catch (_) { /* ignore */ }
  }
  const anchor = String(suggestion?.anchor_text || '').trim();
  if (anchor && anchor.length >= 2) {
    const stamped = document.querySelectorAll('[data-taskplugin-nid]');
    for (const el of stamped) {
      const t = String(el.textContent || '').replace(/\s+/g, ' ');
      if (t.includes(anchor)) return el;
    }
  }
  return null;
}

function layoutPageAdvisorCards() {
  const cardsRoot = document.getElementById('taskplugin-page-advisor-cards');
  if (!cardsRoot) return;
  const cardEls = cardsRoot.querySelectorAll('.taskplugin-page-advisor-float-card');
  let cornerIndex = 0;
  cardEls.forEach((card) => {
    const idx = Number(card.getAttribute('data-order') || 0);
    const sug = pageAdvisorState.suggestions[idx];
    const anchor = sug ? resolveSuggestionAnchor(sug) : null;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      let top = Math.max(8, Math.min(window.innerHeight - 120, r.top));
      let left = Math.min(window.innerWidth - 280, r.right + 8);
      if (left < 8) left = Math.max(8, r.left);
      card.style.top = `${Math.round(top)}px`;
      card.style.left = `${Math.round(left)}px`;
      card.classList.remove('taskplugin-page-advisor-corner');
    } else {
      const top = Math.max(8, window.innerHeight - 160 - cornerIndex * 96);
      const left = Math.max(8, window.innerWidth - 300);
      card.style.top = `${Math.round(top)}px`;
      card.style.left = `${Math.round(left)}px`;
      card.classList.add('taskplugin-page-advisor-corner');
      cornerIndex += 1;
    }
  });
}

function onPageAdvisorCheckChange(ev) {
  const input = ev.target;
  if (!input || !input.classList.contains('taskplugin-page-advisor-check')) return;
  const id = String(input.value || '');
  const sug = pageAdvisorState.suggestions.find((s) => String(s.id) === id);
  const session = getPageAdvisorPreviewSession();
  if (!sug || !session) {
    syncPageAdvisorFillButtons();
    return;
  }
  if (input.checked) {
    session.applySuggestion(sug);
  } else {
    session.undoOne(id);
  }
  syncPageAdvisorFillButtons();
}

function showPageAdvisorSuggestions(payload) {
  const layer = ensurePageAdvisorLayer();
  const cards = document.getElementById('taskplugin-page-advisor-cards');
  const links = document.getElementById('taskplugin-page-advisor-links');
  const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
  pageAdvisorState = {
    suggestions,
    pageUrl: String(payload?.pageUrl || ''),
    jobId: String(payload?.jobId || ''),
  };

  getPageAdvisorPreviewSession()?.undoAll();

  if (links) {
    links.hidden = true;
    links.innerHTML = '';
  }

  if (!suggestions.length) {
    if (cards) {
      cards.innerHTML = '<div class="taskplugin-page-advisor-status-card">未返回可用建议</div>';
    }
  } else if (cards) {
    cards.innerHTML = suggestions.map((s, idx) => {
      const id = String(s.id != null ? s.id : `s${idx}`);
      const title = esc(s.title || '建议');
      const summary = esc(s.summary || s.detail || '');
      return `
        <div class="taskplugin-page-advisor-float-card" data-order="${idx}" data-sid="${esc(id)}">
          <label class="taskplugin-page-advisor-item">
            <input type="checkbox" class="taskplugin-page-advisor-check" value="${esc(id)}" data-order="${idx}" checked>
            <span class="taskplugin-page-advisor-item-body">
              <strong>${title}</strong>
              <span class="taskplugin-page-advisor-summary">${summary}</span>
            </span>
          </label>
        </div>
      `;
    }).join('');
    cards.querySelectorAll('.taskplugin-page-advisor-check').forEach((el) => {
      el.addEventListener('change', onPageAdvisorCheckChange);
      // 默认勾选 → 立即预览
      const id = String(el.value || '');
      const sug = pageAdvisorState.suggestions.find((s) => String(s.id) === id);
      if (sug) getPageAdvisorPreviewSession()?.applySuggestion(sug);
    });
  }

  setPageAdvisorError('');
  openFloatPanelForAdvisor();
  layer.hidden = false;
  syncPageAdvisorFillButtons();
  layoutPageAdvisorCards();
  showPageAdvisorLayer();
}

function showPageAdvisorResourceError(payload) {
  const layer = ensurePageAdvisorLayer();
  const cards = document.getElementById('taskplugin-page-advisor-cards');
  const links = document.getElementById('taskplugin-page-advisor-links');
  if (cards) {
    cards.innerHTML = `<div class="taskplugin-page-advisor-status-card">${esc(payload?.message || '未配置智能体资源')}</div>`;
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
  syncPageAdvisorFillButtons();
  openFloatPanelForAdvisor();
  layer.hidden = false;
  showPageAdvisorLayer();
}

function collectSelectedSuggestionIds() {
  const checks = document.querySelectorAll('#taskplugin-page-advisor-cards .taskplugin-page-advisor-check:checked');
  const ordered = Array.from(checks).sort((a, b) => {
    const ao = Number(a.getAttribute('data-order') || 0);
    const bo = Number(b.getAttribute('data-order') || 0);
    return ao - bo;
  });
  return ordered.map((el) => el.value);
}

function syncPageAdvisorFillButtons() {
  const ids = collectSelectedSuggestionIds();
  const allBtn = document.getElementById('taskplugin-page-advisor-fill-all');
  const oneBtn = document.getElementById('taskplugin-page-advisor-fill-one');
  const disabled = ids.length === 0;
  if (allBtn) {
    allBtn.disabled = disabled;
    allBtn.setAttribute('aria-busy', 'false');
    allBtn.textContent = '全部填入';
  }
  if (oneBtn) {
    oneBtn.disabled = disabled;
    oneBtn.setAttribute('aria-busy', 'false');
    oneBtn.textContent = '逐条填入';
  }
}

async function confirmPageAdvisorFill(opts = {}) {
  const mode = opts.mode === 'one' ? 'one' : 'all';
  const allBtn = document.getElementById('taskplugin-page-advisor-fill-all');
  const oneBtn = document.getElementById('taskplugin-page-advisor-fill-one');
  const activeBtn = mode === 'one' ? oneBtn : allBtn;

  const runFill = () => {
    let selectedIds = collectSelectedSuggestionIds();
    if (!selectedIds.length) {
      setPageAdvisorError('请至少勾选一条建议');
      return { filled: false };
    }
    if (mode === 'one') {
      selectedIds = [selectedIds[0]];
    }
    const Fill = typeof PageAdvisorFill !== 'undefined' ? PageAdvisorFill : null;
    if (!Fill) {
      setPageAdvisorError('PageAdvisorFill 未加载');
      return { filled: false };
    }
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

    const session = getPageAdvisorPreviewSession();
    if (mode === 'all') {
      session?.undoAll();
      closePageAdvisorModal();
      if (typeof showResult === 'function') {
        showResult('已将优化建议填入任务描述（未自动创建任务）', 'success');
      }
    } else {
      const id = selectedIds[0];
      session?.undoOne(id);
      const card = document.querySelector(`.taskplugin-page-advisor-float-card[data-sid="${String(id).replace(/"/g, '')}"]`);
      card?.remove();
      pageAdvisorState.suggestions = pageAdvisorState.suggestions.filter((s) => String(s.id) !== id);
      syncPageAdvisorFillButtons();
      layoutPageAdvisorCards();
      if (!pageAdvisorState.suggestions.length) {
        closePageAdvisorModal();
      }
      if (typeof showResult === 'function') {
        showResult('已填入一条建议（未自动创建任务）', 'success');
      }
    }
    return { filled: true, createTaskCalled: false };
  };

  if (pageAdvisorConfirmGuard) {
    if (activeBtn) {
      activeBtn.disabled = true;
      activeBtn.setAttribute('aria-busy', 'true');
      activeBtn.textContent = '填入中…';
    }
    try {
      const outcome = await pageAdvisorConfirmGuard.run(async () => runFill());
      if (outcome.skipped) return;
    } finally {
      syncPageAdvisorFillButtons();
    }
    return;
  }

  if (pageAdvisorBusy) return;
  pageAdvisorBusy = true;
  try {
    runFill();
  } finally {
    pageAdvisorBusy = false;
    syncPageAdvisorFillButtons();
  }
}
