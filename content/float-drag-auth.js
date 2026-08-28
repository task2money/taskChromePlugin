/**
 * 浮窗拖拽、鉴权刷新、storage 监听。
 */
function setupElementPicker() {
  document.addEventListener('keydown', onShortcutKeyDown, true);
  adjustCancel?.addEventListener('click', (e) => {
    e.preventDefault();
    closeAdjustModal();
  });
  adjustConfirm?.addEventListener('click', (e) => {
    e.preventDefault();
    confirmAdjustModal();
  });
  adjustInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && adjustModal && !adjustModal.hidden) {
      e.preventDefault();
      confirmAdjustModal();
    }
  });
}

function syncDescResetButton() {
  if (!descResetBtn) return;
  if (typeof CreateTaskPayload === 'undefined' || typeof CreateTaskPayload.shouldEnableDescReset !== 'function') {
    throw new Error('CreateTaskPayload.shouldEnableDescReset 未加载');
  }
  descResetBtn.disabled = !CreateTaskPayload.shouldEnableDescReset(descInput.value);
}

function setupDescReset() {
  if (!descResetBtn) {
    console.warn('[taskChromePlugin] desc reset button missing');
    return;
  }
  descInput.addEventListener('input', syncDescResetButton);
  descResetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (descResetBtn.disabled) return;
    descInput.value = '';
    syncDescResetButton();
    descInput.focus();
  });
  syncDescResetButton();
}

// ---- Drag Logic ----
function setupDrag() {
  btn.addEventListener('mousedown', onDragStart);
  btn.addEventListener('dragstart', (e) => e.preventDefault());
}

function onDragStart(e) {
  if (e.button !== 0) return;
  isDragging = true;
  hasMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = btn.getBoundingClientRect();
  if (btn.style.bottom && btn.style.bottom !== 'auto') {
    btn.style.left = rect.left + 'px';
    btn.style.top = rect.top + 'px';
    btn.style.bottom = 'auto';
    btn.style.right = 'auto';
  }
  btnStartX = rect.left;
  btnStartY = rect.top;
  btn.style.transition = 'none';
  btn.style.cursor = 'grabbing';
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!isDragging) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;
  if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
  hasMoved = true;
  let newX = btnStartX + dx;
  let newY = btnStartY + dy;
  const w = btn.offsetWidth;
  const h = btn.offsetHeight;
  newX = Math.max(0, Math.min(newX, window.innerWidth - w));
  newY = Math.max(0, Math.min(newY, window.innerHeight - h));
  btn.style.left = newX + 'px';
  btn.style.top = newY + 'px';
}

function onDragEnd() {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (!isDragging) return;
  isDragging = false;
  btn.style.transition = '';
  btn.style.cursor = '';
  if (hasMoved) {
    const x = parseInt(btn.style.left, 10);
    const y = parseInt(btn.style.top, 10);
    if (!isNaN(x) && !isNaN(y)) {
      chrome.runtime.sendMessage({ action: 'saveFloatBallPosition', x, y }).catch(() => {});
    }
  }
}

btn.addEventListener('click', async (e) => {
  if (hasMoved) {
    hasMoved = false;
    return;
  }
  // 选元素模式下，点击悬浮球 = 取消选择
  if (pickMode) {
    setPickMode(false);
    return;
  }
  isOpen = !isOpen;
  panel.classList.toggle('taskplugin-open', isOpen);
  btn.classList.toggle('taskplugin-active', isOpen);
  btn.textContent = isOpen ? '×' : '+';

  if (isOpen) {
    await refreshAuthAndWorkspaces();
    openSnapshot = captureOpenSnapshot();
  }
});

// ================================================================
//  登录 / 工作空间 / 项目（业务 API 一律经 Service Worker，避免页面上下文差异）
// ================================================================

/**
 * 经 SW 调用业务 API。SW 会回退到 storage 中的 baseUrl/token。
 */
async function swApi(action, extra = {}, timeoutMs = 12000) {
  const r = await sendMessageWithTimeout({
    action,
    baseUrl: apiCfg.baseUrl,
    token: apiCfg.token,
    ...extra,
  }, timeoutMs);
  if (!r?.success) {
    const err = new Error(r?.error || `${action} 失败`);
    const tid = (typeof extractTraceId === 'function' ? extractTraceId(r) : '') || r?.traceId || '';
    if (tid) err.traceId = tid;
    throw err;
  }
  return r.data;
}

/**
 * 获取工作空间创建任务字段设置（与 createTaskFieldSettings.js 对齐）。
 * 返回字段名 → 是否可见的映射，例如 { description: true, code_lang: false, ... }。
 * 用于隐藏 Web 端工作空间配置中关闭的字段，保持插件与工作面板行为一致。
 *
 * 若 SW 尚未实现对应 API action，静默回退默认配置（全部开启，仅 code_lang / structured_fields 关闭）。
 * @param {string} companyId
 * @returns {Promise<Record<string, boolean>>}
 */
async function fetchCreateTaskFieldSettings(companyId) {
  try {
    const fields = await swApi('getCreateTaskFieldSettings', { companyId });
    if (fields && typeof fields === 'object') return fields;
  } catch (_) { /* SW 尚未实现则静默回退默认 */ }
  // 默认值：与 defaultCreateTaskFieldSettings() 对齐
  return {
    description: true, task_kind: true, code_lang: false,
    structured_fields: false, project_branch: true, container_image: true,
    feature_params: true, priority: true, due_date: true,
    auto_run: true, owner: true, assignees: true,
  };
}

async function resolveTaskOwner(endpointMapping, wsId) {
  if (endpointMapping?.owner) return String(endpointMapping.owner);
  const cred = await Storage.getCredentials();
  if (cred.memberId) return String(cred.memberId);

  const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
  const companyId = ws?.company_id || ws?.companyId;
  if (companyId && cred.userId) {
    try {
      const data = await swApi('getMembers', { companyId: String(companyId) });
      const members = Array.isArray(data) ? data : (data?.results || data?.data || []);
      const mine = members.find((m) => String(m.user_id || m.userId) === String(cred.userId));
      if (mine?.id) return String(mine.id);
      if (members.length === 1) return String(members[0].id);
    } catch (e) {
      console.warn('[taskChromePlugin] resolveTaskOwner getMembers 失败:', e.message);
    }
  }
  return '';
}

/**
 * 经 Service Worker 读取登录态（与 Popup 同源），避免 content script
 * 直读 storage 与过期字段不同步、或扩展上下文异常时误判未登录。
 */
async function fetchAuthStatusFromBackground() {
  const r = await sendMessageWithTimeout({ action: 'getAuthStatus' }, 5000);
  if (!r?.success || !r.data) {
    throw new Error(r?.error || 'getAuthStatus 失败');
  }
  return r.data;
}

function applyLoginBadge(loggedIn, { expired = false, expiryHint = null, invalidated = false } = {}) {
  if (invalidated) {
    badge.textContent = '请刷新页面';
    badge.className = 'taskplugin-badge taskplugin-badge-err';
    badge.title = '扩展已重载，请刷新本页后重试';
    return;
  }
  if (!loggedIn) {
    badge.textContent = expired ? '会话过期' : '未登录';
    badge.className = 'taskplugin-badge taskplugin-badge-err';
    badge.title = expired ? '请在扩展弹窗中重新登录' : '请先在扩展弹窗中登录';
    return;
  }
  if (expiryHint?.text) {
    badge.textContent = expiryHint.text;
    badge.className = expiryHint.level === 'critical'
      ? 'taskplugin-badge taskplugin-badge-warn taskplugin-badge-critical'
      : 'taskplugin-badge taskplugin-badge-warn';
    badge.title = '登录会话即将过期，请尽快在扩展弹窗中重新登录';
    return;
  }
  badge.textContent = '已登录';
  badge.className = 'taskplugin-badge taskplugin-badge-ok';
  badge.title = '';
}

function workspaceSelectNeedsLoad() {
  if (typeof FloatWorkspaceSelect === 'undefined'
      || typeof FloatWorkspaceSelect.selectNeedsWorkspaceLoad !== 'function') {
    return workspacesData.length === 0;
  }
  return FloatWorkspaceSelect.selectNeedsWorkspaceLoad(wsSelect, {
    workspacesCount: workspacesData.length,
  });
}

function applyWorkspaceSelectFromAuth({ loggedIn, mode, invalidated = false }) {
  const selectNeeds = workspaceSelectNeedsLoad();
  if (typeof FloatWorkspaceSelect === 'undefined') {
    console.warn('[taskChromePlugin] FloatWorkspaceSelect 未加载');
    if (!loggedIn) {
      wsSelect.innerHTML = `<option value="">-- ${invalidated ? '请刷新页面后重试' : '请先登录'} --</option>`;
    } else if (mode !== 'badgeOnly' || selectNeeds) {
      wsSelect.innerHTML = '<option value="">加载中...</option>';
    }
    return;
  }
  const action = FloatWorkspaceSelect.resolveFloatWorkspaceSelectAction({
    loggedIn,
    mode,
    invalidated,
    selectNeedsWorkspaceLoad: selectNeeds,
  });
  const text = FloatWorkspaceSelect.floatWorkspaceSelectPlaceholder(action);
  if (text == null) return;
  wsSelect.innerHTML = `<option value="">${text}</option>`;
}

/**
 * @param {{ mode?: 'full' | 'badgeOnly' }} [opts]
 *   full：完整鉴权刷新（可进入「加载中」再由 loadWorkspaces 填充）
 *   badgeOnly：仅角标，已登录时不得冲掉工作空间下拉框
 */
async function checkLoginStatus({ mode = 'full' } = {}) {
  try {
    let cfg;
    let expired = false;
    let loggedIn = false;
    let expiryHint = null;
    try {
      const auth = await fetchAuthStatusFromBackground();
      cfg = {
        baseUrl: auth.baseUrl,
        token: auth.token || '',
        tokenExpiresAt: auth.tokenExpiresAt || 0,
        tokenIssuedAt: auth.tokenIssuedAt || 0,
      };
      expired = !!auth.expired;
      loggedIn = !!auth.loggedIn;
      expiryHint = auth.expiryHint || Storage.formatTokenExpiryHint(auth.remainingSeconds);
    } catch (bgErr) {
      console.warn('[taskChromePlugin] getAuthStatus 回退 Storage:', bgErr.message);
      cfg = await Storage.getApiConfig();
      expired = await Storage.isTokenExpired();
      loggedIn = !!(cfg.token && !expired);
      const remaining = await Storage.getTokenRemainingSeconds();
      expiryHint = Storage.formatTokenExpiryHint(remaining);
    }

    apiCfg = cfg;
    if (loggedIn) {
      isLoggedIn = true;
      applyLoginBadge(true, { expiryHint });
    } else {
      isLoggedIn = false;
      applyLoginBadge(false, { expired: !!(cfg.token && expired) });
    }
    applyWorkspaceSelectFromAuth({ loggedIn, mode });
  } catch (e) {
    console.warn('[taskChromePlugin] checkLoginStatus 失败:', e.message);
    isLoggedIn = false;
    const invalidated = /Extension context invalidated/i.test(String(e.message || e));
    applyLoginBadge(false, { invalidated });
    applyWorkspaceSelectFromAuth({ loggedIn: false, mode, invalidated });
  }
}

async function refreshAuthAndWorkspaces() {
  workspacesData = [];
  await checkLoginStatus({ mode: 'full' });
  if (isLoggedIn) {
    await loadWorkspaces();
  }
}

/**
 * auth 刷新去抖（500ms 尾缘合批，OPT-20260808-019）：
 * storage.onChanged 对 token/baseUrl/userId/memberId 任一变更都会触发，
 * 多键写入与多标签页广播会在毫秒级连发多次 → 每次都是一轮
 * checkLoginStatus(full) + loadWorkspaces()（网络请求 + DOM 重建）。
 * 轮询密集型页面（work-panel）下这是主要的 CPU/网络风暴来源之一。
 * 去抖后一次变更风暴只刷新一次；登录等少量场景可直接 await 原函数。
 */
var authRefreshTimer = null;
var authRefreshPendingFromHidden = false;
var AUTH_REFRESH_DEBOUNCE_MS = 500;
function scheduleAuthRefresh() {
  if (authRefreshTimer) clearTimeout(authRefreshTimer);
  authRefreshTimer = setTimeout(() => {
    authRefreshTimer = null;
    // OPT-20260808-023 F5: 不可见标签页跳过全量刷新（跨页放大降噪）——
    // auth 广播会触发 N 个标签页同时 checkLoginStatus(full)+loadWorkspaces()
    // （网络+DOM 突发）；隐藏页不再跑 60s 角标定时器。
    // 跳过时打 pending：可见性 tick 必须 full 补跑，否则角标已登录、下拉仍「请先登录」。
    if (shouldSkipDebouncedAuthRefresh(document)) {
      authRefreshPendingFromHidden = true;
      return;
    }
    refreshAuthAndWorkspaces().catch((e) => {
      console.warn('[taskChromePlugin] 去抖后 auth 刷新失败:', e.message);
    });
  }, AUTH_REFRESH_DEBOUNCE_MS);
}

/**
 * 角标/可见性 tick：默认只刷新角标；若 hidden-skip 待补跑或已登录但下拉仍是
 * 未登录占位，则补拉工作空间，避免「已登录 + 请先登录」分裂。
 */
async function refreshAuthBadgeOnly() {
  const pendingHidden = authRefreshPendingFromHidden;
  authRefreshPendingFromHidden = false;
  const selectNeedsLoad = workspaceSelectNeedsLoad();
  const decide = (typeof resolveAuthBadgeTickFollowUp === 'function')
    ? resolveAuthBadgeTickFollowUp
    : null;
  const pre = decide
    ? decide({ pendingHiddenRefresh: pendingHidden, loggedIn: isLoggedIn, selectNeedsLoad })
    : (pendingHidden ? 'full' : 'none');
  if (pre === 'full') {
    console.info('[taskChromePlugin] hidden-skip 补跑全量 auth/workspaces');
    await refreshAuthAndWorkspaces();
    return;
  }
  await checkLoginStatus({ mode: 'badgeOnly' });
  const followUp = decide
    ? decide({ pendingHiddenRefresh: false, loggedIn: isLoggedIn, selectNeedsLoad })
    : (isLoggedIn && selectNeedsLoad ? 'loadWorkspaces' : 'none');
  if (followUp === 'loadWorkspaces') {
    console.info('[taskChromePlugin] 角标已登录但工作空间未加载，补拉工作空间');
    await loadWorkspaces();
  }
}

var authBadgeCtl = null;
function startAuthBadgeTimer() {
  if (authBadgeCtl) {
    authBadgeCtl.stop();
    authBadgeCtl = null;
  }
  if (window.__taskpluginAuthBadgeTimer) {
    clearInterval(window.__taskpluginAuthBadgeTimer);
    window.__taskpluginAuthBadgeTimer = null;
  }
  if (typeof startDocumentVisibilityInterval !== 'function') return;
  authBadgeCtl = startDocumentVisibilityInterval(60 * 1000, () => refreshAuthBadgeOnly().catch((e) => {
    console.warn('[taskChromePlugin] 悬浮面板定时刷新登录态失败:', e.message);
  }));
  window.__taskpluginAuthBadgeCtl = authBadgeCtl;
}

function handleApiAuthFailure(err) {
  const msg = String(err?.message || err || '');
  if (!/\b401\b/.test(msg)) return false;
  isLoggedIn = false;
  badge.textContent = '会话失效';
  badge.className = 'taskplugin-badge taskplugin-badge-err';
  badge.title = '请在扩展弹窗中重新登录';
  wsSelect.innerHTML = '<option value="">-- 请在扩展中重新登录 --</option>';
  return true;
}

/** storage 变更：单一监听合并登录态 / 悬浮球 / 快捷键（禁止三个 onChanged 叠加唤醒） */
function bindStorageListeners() {
  try {
    if (!chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.floatBallEnabled !== undefined) {
        const enabled = changes.floatBallEnabled.newValue !== false;
        root.style.setProperty('display', enabled ? 'block' : 'none', 'important');
        if (!enabled) hideFloatPanel();
      }
      if (changes.elementPickerShortcut) {
        const combo = resolveShortcutCombo(changes.elementPickerShortcut.newValue);
        if (combo) {
          pickShortcutCombo = combo;
          renderShortcutHints();
        }
      }
      if (!changes.token && !changes.tokenExpiresAt && !changes.baseUrl && !changes.userId && !changes.memberId) {
        return;
      }
      scheduleAuthRefresh();
    });
  } catch (e) {
    console.warn('[taskChromePlugin] bindStorageListeners 失败:', e.message);
  }
}

/** 解析快捷键存储值 → 规范组合串（兼容旧版 'cmd'/'ctrl'，与 Storage.getElementPickerShortcut 迁移一致） */
function resolveShortcutCombo(v) {
  if (v === 'cmd') return 'Command+Shift+X';
  if (v === 'ctrl') return 'Ctrl+Shift+X';
  return Storage.normalizeShortcut(v);
}

/**
 * storage 变更时同步快捷键组合已并入 bindStorageListeners。
 */

