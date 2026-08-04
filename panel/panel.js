/**
 * DevTools Panel 主逻辑
 * Tab 1: 单请求创建任务 (含搜索/过滤)
 * Tab 2: 批量错误捕获 & 创建
 * Tab 3: 错误列表查看
 * Tab 4: 历史记录 & 重试
 * Tab 5: 使用说明（lib/user-guide.js）
 */

const Panel = (() => {
  // ---- State ----
  let apiConfig = { baseUrl: 'https://aidevpush.com', token: '' };
  let isLoggedIn = false;
  /** 上一轮 refreshAuthState 的登录态，用于检测「已登录→过期/登出」翻转 */
  let wasLoggedIn = false;
  let selectedRequest = null;
  let recentRequests = [];
  let workspaces = [];
  let projectsCache = {};
  let membersCache = {};   // { companyId: [{id, user_id, member_name, ...}] }
  let progressColumnsCache = {};
  let currentUserId = '';  // set after login
  let currentMemberId = '';  // from login response current_company.member_id
  /** 请求列表是否已完成至少一次引导刷新（用于离开 HTML 初始 loading） */
  let requestListBootstrapped = false;
  let pendingAidevMatches = null;

  const Bootstrap = (typeof PanelRequestBootstrap !== 'undefined')
    ? PanelRequestBootstrap
    : null;
  const requestMsgBuffer = Bootstrap
    ? Bootstrap.createRequestMessageBuffer()
    : null;

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function isRequestCanceled(req) {
    return !!(req?.canceled || req?.statusCode === 0);
  }

  function formatRequestStatusLabel(req) {
    if (isRequestCanceled(req)) return 'Canceled';
    return String(req?.statusCode ?? '');
  }

  function getRequestStatusClass(req) {
    if (isRequestCanceled(req)) return 'canceled';
    if (req?.statusCode >= 400) return 'error';
    return 'ok';
  }

  function handleRequestMessage(data) {
    if (!data?.action) return;
    if (data.action === 'initRequests') {
      recentRequests = data.requests || [];
      recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      applyRequestFilters();
    } else if (data.action === 'newRequest') {
      if (!data.request) return;
      recentRequests.unshift(data.request);
      if (recentRequests.length > 500) recentRequests.pop();
      applyRequestFilters();
    } else if (data.action === 'requestUpdated') {
      const updated = data.request;
      if (!updated?.id) return;
      const idx = recentRequests.findIndex((r) => r.id === updated.id);
      if (idx >= 0) {
        recentRequests[idx] = updated;
        if (selectedRequest?.id === updated.id) {
          selectedRequest = updated;
          fillRequestDetail(updated);
        }
      }
    }
  }

  /**
   * 接通 head 内早期缓冲 + PanelRequestBootstrap 缓冲。
   * 必须在任何 await 之前调用，避免 onShown 的 initRequests 丢失。
   */
  function bindRequestMessagePipeline() {
    if (requestMsgBuffer) {
      requestMsgBuffer.setConsumer(handleRequestMessage);
      window.__tcpRequestMsgSink = (data) => requestMsgBuffer.push(data);
    } else {
      window.__tcpRequestMsgSink = handleRequestMessage;
      window.addEventListener('message', (event) => {
        if (!event.data) return;
        handleRequestMessage(event.data);
      });
    }
    const early = Array.isArray(window.__tcpRequestMsgEarly)
      ? window.__tcpRequestMsgEarly.splice(0, window.__tcpRequestMsgEarly.length)
      : [];
    for (const data of early) {
      if (requestMsgBuffer) requestMsgBuffer.push(data);
      else handleRequestMessage(data);
    }
  }

  function mountUserGuide() {
    const host = $('#panel-user-guide');
    if (!host) return;
    if (typeof UserGuide === 'undefined') {
      console.warn('[taskChromePlugin] UserGuide 未加载，面板使用说明跳过');
      host.textContent = '使用说明模块未加载';
      return;
    }
    UserGuide.mount(host, UserGuide.renderFullGuideHtml({ surface: 'panel' }));
  }

  /**
   * 工作空间字段设置（TODO）：
   * 工作空间可配置创建任务表单字段的显隐（见 createTaskFieldSettings.js）。
   * 插件应在 init 或 onSingleWorkspaceChange 时调 fetchCreateTaskFieldSettings(companyId)，
   * 然后用 isCreateTaskFieldEnabled(settings, key) 判断各字段是否显示。
   * 已隐藏的字段应在面板中设置 display:none，保持与 Web 端工作面板行为一致。
   */

  // ---- Init ----
  async function init() {
    // 先挂请求列表管道，再做任何 await（修复卡在「正在加载请求列表...」）
    bindRequestMessagePipeline();
    mountUserGuide();

    await refreshAuthState();
    await loadSavedOwner();
    bindTabs();
    bindAuthListener();
    bindSingleTab();
    bindBatchTab();
    bindErrorListTab();
    bindHistoryTab();
    initBranchDatalistPresets();
    // 立即加载工作空间（不等待用户点击请求）
    loadWorkspaces('singleWorkspace');
    await checkConnection();
    startAuthBadgeTimer();
    // 数据由 postMessage 推送；若 1.5s 内未收到则从 SW 兜底（空列表也必须刷新 UI）
    setTimeout(async () => {
      if (recentRequests.length === 0) {
        try {
          const res = await sendMessage({ action: 'getRecentRequests', filter: {}, limit: 200 });
          const merged = Bootstrap
            ? Bootstrap.mergeFallbackRecentRequests(recentRequests, res)
            : ((res?.success && res.data?.length > 0) ? res.data : recentRequests);
          recentRequests = merged;
          if (recentRequests.length > 0) {
            recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          }
        } catch (_) { /* ignore */ }
      }
      if (!Bootstrap || Bootstrap.mustRefreshRequestListUiAfterFallback()) {
        applyRequestFilters();
      }
    }, 1500);
    setRequestLoading(false);
  }

  async function loadSavedOwner() {
    // Kept for backward compatibility; members now loaded on workspace change.
  }

  async function loadMembers(companyId) {
    const sel = $('#singleOwner');
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    if (membersCache[companyId]) {
      renderMemberOptions(companyId);
      return;
    }
    try {
      const data = await swApi('getMembers', { companyId });
      const members = Array.isArray(data) ? data : (data?.results || data?.data || []);
      membersCache[companyId] = members;
      renderMemberOptions(companyId);
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  function renderMemberOptions(companyId) {
    const members = membersCache[companyId] || [];
    const sel = $('#singleOwner');
    sel.innerHTML = '<option value="">-- 请选择负责人 --</option>';
    let defaultMemberId = '';
    // 优先用登录响应中的 member_id 精确匹配
    if (currentMemberId && members.some(m => String(m.id) === currentMemberId)) {
      defaultMemberId = currentMemberId;
    }
    for (const m of members) {
      const mid = String(m.id);
      const name = m.member_name || m.name || mid;
      const uid = String(m.user_id || m.userId || '');
      sel.innerHTML += `<option value="${mid}" data-user-id="${uid}">${escHtml(name)}</option>`;
      // 回退：user_id 匹配
      if (!defaultMemberId && currentUserId && uid === currentUserId) {
        defaultMemberId = mid;
      }
    }
    if (defaultMemberId) {
      sel.value = defaultMemberId;
    } else if (members.length === 1) {
      sel.value = String(members[0].id);
    }
    renderAssigneeCheckboxes(companyId);
  }

  async function loadProgressColumns(companyId, wsId, selectId) {
    const sel = $(`#${selectId}`);
    sel.innerHTML = '<option value="">加载中...</option>';
    const cacheKey = `${companyId}:${wsId}`;
    if (progressColumnsCache[cacheKey]) {
      renderProgressColumnOptions(selectId, cacheKey);
      return;
    }
    if (!(await ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await swApi('fetchProgressColumns', { companyId, workspaceId: wsId });
      const columns = data?.columns || [];
      progressColumnsCache[cacheKey] = columns;
      renderProgressColumnOptions(selectId, cacheKey);
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  function renderProgressColumnOptions(selectId, cacheKey) {
    const columns = progressColumnsCache[cacheKey] || [];
    const sel = $(`#${selectId}`);
    sel.innerHTML = '<option value="">-- 自动 --</option>';
    for (const col of columns) {
      const cid = String(col.id);
      const name = col.name || cid;
      sel.innerHTML += `<option value="${cid}">${escHtml(name)}</option>`;
    }
    if (columns.length > 0) sel.value = String(columns[0].id);
  }

  let authBadgeTimer = null;
  const AUTH_BADGE_REFRESH_MS = 60 * 1000;

  /**
   * 清空 workspace / 项目 / 成员等会话相关缓存，并重置选择器 UI。
   * @param {{ reason?: 'expired'|'logout'|'auth_failure', notify?: boolean }} [opts]
   */
  function clearWorkspaceAuthCaches(opts = {}) {
    const reason = opts.reason || 'expired';
    const notify = opts.notify !== false;

    workspaces = [];
    projectsCache = {};
    membersCache = {};
    progressColumnsCache = {};

    const wsHint = reason === 'logout'
      ? '-- 请先登录 --'
      : '-- 会话过期，请重新登录 --';

    for (const id of ['singleWorkspace', 'batchWorkspace']) {
      const sel = $(`#${id}`);
      if (sel) sel.innerHTML = `<option value="">${wsHint}</option>`;
    }

    const singleProjects = $('#singleProjects');
    if (singleProjects) singleProjects.innerHTML = '<p class="placeholder">请先重新登录</p>';
    const batchProjects = $('#batchProjects');
    if (batchProjects) batchProjects.innerHTML = '<p class="placeholder">请先重新登录</p>';

    const ownerSel = $('#singleOwner');
    if (ownerSel) ownerSel.innerHTML = '<option value="">请重新登录</option>';
    const progressSel = $('#singleProgressColumn');
    if (progressSel) progressSel.innerHTML = '<option value="">请重新登录</option>';
    const deliverableSel = $('#singleDeliverable');
    if (deliverableSel) deliverableSel.innerHTML = '<option value="">请重新登录</option>';
    const assignees = $('#singleAssignees');
    if (assignees) assignees.innerHTML = '<p class="placeholder">请先重新登录</p>';
    const repoBases = $('#singleRepoBases');
    if (repoBases) repoBases.innerHTML = '<p class="placeholder">请先重新登录</p>';

    const batchProgress = $('#batchProgressColumn');
    if (batchProgress) batchProgress.innerHTML = '<option value="">请重新登录</option>';
    const batchDeliverable = $('#batchDeliverable');
    if (batchDeliverable) batchDeliverable.innerHTML = '<option value="">请重新登录</option>';

    if (notify) {
      const msg = reason === 'logout'
        ? '⚠️ 已退出登录，请在扩展弹窗中重新登录'
        : '⏰ 会话已过期，工作空间缓存已清空，请在扩展弹窗中重新登录';
      showR('singleResult', 'error', msg);
      showR('batchResult', 'error', msg);
    }
  }

  /**
   * 检测登录态翻转：已登录 → 未登录/过期时清缓存并提示。
   * @param {boolean} nextLoggedIn
   * @param {{ expired?: boolean, tokenPresent?: boolean }} [meta]
   */
  function handleAuthSessionTransition(nextLoggedIn, meta = {}) {
    const prev = wasLoggedIn;
    wasLoggedIn = nextLoggedIn;
    if (!prev || nextLoggedIn) return;
    const reason = meta.tokenPresent || meta.expired ? 'expired' : 'logout';
    clearWorkspaceAuthCaches({ reason, notify: true });
  }

  async function refreshAuthState() {
    let expired = false;
    let expiryHint = null;
    try {
      const r = await sendMessage({ action: 'getAuthStatus', _timeout: 5000 });
      if (r?.success && r.data) {
        apiConfig = {
          baseUrl: r.data.baseUrl,
          token: r.data.token || '',
          tokenExpiresAt: r.data.tokenExpiresAt || 0,
          tokenIssuedAt: r.data.tokenIssuedAt || 0,
        };
        if (r.data.userId) currentUserId = String(r.data.userId);
        if (r.data.memberId) currentMemberId = String(r.data.memberId);
        expired = !!r.data.expired;
        isLoggedIn = !!r.data.loggedIn;
        expiryHint = r.data.expiryHint || Storage.formatTokenExpiryHint(r.data.remainingSeconds);
      } else {
        throw new Error(r?.error || 'getAuthStatus 失败');
      }
    } catch (_) {
      apiConfig = await Storage.getApiConfig();
      const cred = await Storage.getCredentials();
      if (cred.userId) currentUserId = String(cred.userId);
      if (cred.memberId) currentMemberId = String(cred.memberId);
      expired = await Storage.isTokenExpired();
      isLoggedIn = !!(apiConfig.token && !expired);
      const remaining = await Storage.getTokenRemainingSeconds();
      expiryHint = Storage.formatTokenExpiryHint(remaining);
    }
    handleAuthSessionTransition(isLoggedIn, {
      expired,
      tokenPresent: !!apiConfig.token,
    });
    updateStatusBadge(expired, expiryHint);
    return isLoggedIn;
  }

  async function ensureApiReady() {
    await refreshAuthState();
    return isLoggedIn;
  }

  function handleApiAuthFailure(err) {
    const msg = String(err?.message || err || '');
    if (!/\b401\b/.test(msg)) return false;
    const prev = wasLoggedIn || isLoggedIn;
    isLoggedIn = false;
    wasLoggedIn = false;
    updateStatusBadge(true);
    if (prev) {
      clearWorkspaceAuthCaches({ reason: 'auth_failure', notify: true });
    }
    return true;
  }

  function bindAuthListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action !== 'authStateChanged') return;
      refreshAuthState().then((loggedIn) => {
        if (loggedIn) {
          loadWorkspaces('singleWorkspace');
          if ($('#batchWorkspace')) {
            loadWorkspaces('batchWorkspace');
          }
        }
        // 未登录时 clearWorkspaceAuthCaches 已由 handleAuthSessionTransition 处理
      }).catch((e) => {
        console.warn('[taskChromePlugin] panel authStateChanged 刷新失败:', e.message);
      });
    });
  }

  function updateStatusBadge(expired = false, expiryHint = null) {
    const badge = $('#statusBadge');
    if (!badge) return;
    if (!apiConfig.token) {
      badge.textContent = '⚠️ 未登录';
      badge.className = 'badge badge-disconnected';
      badge.title = '请先在扩展弹窗中登录';
      return;
    }
    if (expired || !isLoggedIn) {
      badge.textContent = '⏰ 会话过期';
      badge.className = 'badge badge-disconnected';
      badge.title = '请在扩展弹窗中重新登录';
      return;
    }
    if (expiryHint?.text) {
      badge.textContent = expiryHint.text;
      badge.className = expiryHint.level === 'critical' ? 'badge badge-disconnected' : 'badge badge-warning';
      badge.title = '登录会话即将过期，请尽快重新登录';
      return;
    }
    badge.textContent = '✅ 已连接';
    badge.className = 'badge badge-connected';
    badge.title = '';
  }

  function startAuthBadgeTimer() {
    if (authBadgeTimer) clearInterval(authBadgeTimer);
    authBadgeTimer = setInterval(() => {
      refreshAuthState().catch((e) => {
        console.warn('[taskChromePlugin] panel 定时刷新登录态失败:', e.message);
      });
    }, AUTH_BADGE_REFRESH_MS);
  }

  async function checkConnection() {
    try {
      const res = await sendMessage({ action: 'ping' });
      if (!res?.pong) throw new Error('No pong');
    } catch (_) {}
  }

  /**
   * 带超时的 chrome.runtime.sendMessage 封装
   * 超时时返回 { error: '消息超时' } 而非 reject，保持与现有 .success 检查模式的兼容
   * @param {object} msg - 消息对象，可包含 _timeout 字段自定义超时(ms)
   */
  function sendMessage(msg) {
    const timeoutMs = msg._timeout || 15000;
    const cleanMsg = { ...msg };
    delete cleanMsg._timeout;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ error: `消息超时 (${timeoutMs}ms): ${cleanMsg.action || 'unknown'}` });
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(cleanMsg)
          .then((resp) => { clearTimeout(timer); resolve(resp); })
          .catch((err) => {
            clearTimeout(timer);
            resolve({ error: err?.message || '消息发送失败' });
          });
      } catch (syncErr) {
        clearTimeout(timer);
        resolve({ error: syncErr?.message || '消息发送异常' });
      }
    });
  }

  /**
   * 经 Service Worker 调用业务 API（与悬浮面板同源，走 initApiFromMessage）
   */
  async function swApi(action, extra = {}, timeoutMs = 15000) {
    const r = await sendMessage({
      action,
      baseUrl: apiConfig.baseUrl,
      token: apiConfig.token,
      _timeout: timeoutMs,
      ...extra,
    });
    if (!r?.success) {
      throw new Error(r?.error || `${action} 失败`);
    }
    return r.data;
  }

  // ---- Merge Target Branch Helpers ----

  const WORK_BRANCH_PRESET_OPTIONS = [
    { value: 'feature', label: 'feature/${日期}_aidev${taskId}_${标题}' },
    { value: 'bugfix', label: 'bugfix/${日期}_aidev${taskId}_${标题}' },
    { value: 'hotfix', label: 'hotfix/${日期}_aidev${taskId}_${标题}' },
    { value: 'release', label: 'release/${日期}_aidev${taskId}' },
  ];

  const WORK_BRANCH_LABEL_TO_PRESET = Object.fromEntries(
    WORK_BRANCH_PRESET_OPTIONS.map((p) => [p.label, p.value]),
  );

  /** 计算接下来第 N 个周四的 YYYYMMDD 日期（N=0 为最近的下一个周四，含今天） */
  function getThursdayYmd(weekOffset = 0) {
    const d = new Date();
    const dayOfWeek = d.getDay(); // 0=Sun ... 4=Thu ... 6=Sat
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    d.setDate(d.getDate() + daysUntilThursday + weekOffset * 7);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  /** 计算接下来 N 个周四，返回 [{value, label, dateYmd}]，标签根据今天是否已过本周四自动调整 */
  function getNextThursdays(count = 3) {
    const result = [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun ... 4=Thu ... 6=Sat
    // 若今天已过周四（周五/周六），则从下周开始；否则从本周开始
    const startWeek = dayOfWeek > 4 ? 1 : 0;
    const labels = dayOfWeek > 4
      ? ['下周四', '下下周四', '下下下周四']
      : ['本周四', '下周四', '下下周四'];
    for (let i = 0; i < count; i++) {
      const ymd = getThursdayYmd(startWeek + i);
      result.push({
        value: `release:${startWeek + i}`,
        label: `release / ${ymd} (${labels[i] || `第${startWeek + i + 1}个周四`})`,
        dateYmd: ymd,
      });
    }
    return result;
  }

  /** 合并目标分支模板选项（含动态 release 周四） */
  function getMergeTargetPresetOptions() {
    const thursdays = getNextThursdays(3);
    return [
      { value: 'develop', label: 'develop' },
      ...thursdays.map((t) => ({ value: t.value, label: t.label })),
      { value: 'main', label: 'main' },
    ];
  }

  function getMergeTargetLabelToPreset() {
    return Object.fromEntries(getMergeTargetPresetOptions().map((p) => [p.label, p.value]));
  }

  /** 向 datalist 追加模板选项（置于 Git 分支之前） */
  function appendPresetOptionsToDatalist(datalist, presetKind) {
    if (!datalist) return;
    const presets = presetKind === 'work' ? WORK_BRANCH_PRESET_OPTIONS : getMergeTargetPresetOptions();
    for (const p of presets) {
      datalist.innerHTML += `<option value="${escHtml(p.label)}">[模板] ${escHtml(p.label)}</option>`;
    }
  }

  function initBranchDatalistPresets() {
    appendPresetOptionsToDatalist($('#singleWorkBranchList'), 'work');
    appendPresetOptionsToDatalist($('#singleMergeTargetList'), 'merge');
    appendPresetOptionsToDatalist($('#batchWorkBranchList'), 'work');
    appendPresetOptionsToDatalist($('#batchMergeTargetList'), 'merge');
  }

  function buildMergeTargetBranchName(presetType) {
    // 处理 release:N 格式
    const releaseMatch = /^release:(\d+)$/.exec(presetType);
    if (releaseMatch) {
      const weekOffset = parseInt(releaseMatch[1], 10);
      const ymd = getThursdayYmd(weekOffset);
      return `release/${ymd}_aidev\${taskId}`;
    }
    if (presetType === 'develop' || presetType === 'main') {
      return presetType;
    }
    return '';
  }

  function handleBranchInputChange(inputId, presetKind, titleSourceId) {
    const input = $(`#${inputId}`);
    if (!input) return;
    const labelMap = presetKind === 'work' ? WORK_BRANCH_LABEL_TO_PRESET : getMergeTargetLabelToPreset();
    const presetKey = labelMap[input.value];
    if (!presetKey) return;
    const branchName = presetKind === 'work'
      ? buildWorkBranchName(presetKey, titleSourceId)
      : buildMergeTargetBranchName(presetKey);
    if (branchName) input.value = branchName;
  }

  function buildWorkBranchName(presetType, titleSourceId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const titleEl = titleSourceId ? $(`#${titleSourceId}`) : null;
    const titleSlug = (titleEl?.value || 'task')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task';
    if (presetType === 'release') {
      return `release/${today}_aidev\${taskId}`;
    }
    if (presetType === 'feature' || presetType === 'bugfix' || presetType === 'hotfix') {
      return `${presetType}/${today}_aidev\${taskId}_${titleSlug}`;
    }
    return '';
  }

  async function fetchSingleBranchLists(wsId, projectIds) {
    await fetchAndPopulateBranches('singleWorkBranchList', wsId, projectIds, 'work');
    await fetchAndPopulateBranches('singleMergeTargetList', wsId, projectIds, 'merge');
  }

  async function fetchBatchBranchLists(wsId, projectIds) {
    await fetchAndPopulateBranches('batchWorkBranchList', wsId, projectIds, 'work');
    await fetchAndPopulateBranches('batchMergeTargetList', wsId, projectIds, 'merge');
  }

  /**
   * 从选中的项目获取 Git 分支列表，填充到 datalist 中
   * @param {string} datalistId - datalist 元素 ID
   * @param {string} wsId - 工作空间 ID
   * @param {string[]} projectIds - 选中的项目 ID 列表
   */
  async function fetchAndPopulateBranches(datalistId, wsId, projectIds, presetKind) {
    const datalist = $(`#${datalistId}`);
    if (!datalist) return;
    datalist.innerHTML = '';
    if (presetKind) appendPresetOptionsToDatalist(datalist, presetKind);

    if (!wsId || !projectIds.length) return;
    if (!(await ensureApiReady())) return;

    const cached = projectsCache[wsId] || [];
    const ws = workspaces.find(w => (w.id || w._id) === wsId);
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return;

    const seen = new Set();
    // 内置预设分支始终显示
    const builtin = ['develop', 'main'];
    for (const b of builtin) {
      if (!seen.has(b)) {
        seen.add(b);
        datalist.innerHTML += `<option value="${b}">${b}  [内置]</option>`;
      }
    }

    // 从每个选中项目获取远程分支（限制最多 3 个项目避免请求过多）
    const toFetch = projectIds.slice(0, 3);
    for (const pid of toFetch) {
      const proj = cached.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      const repoUrl = repos[0];
      if (!repoUrl) continue;

      const shortRepo = extractRepoLabel(repoUrl);
      try {
        const resp = await swApi('getBranches', {
          companyId: String(companyId),
          projectId: pid,
          repoUrl,
        });
        const branches = Array.isArray(resp?.branches) ? resp.branches : (Array.isArray(resp) ? resp : []);
        for (const b of branches) {
          const name = typeof b === 'string' ? b : (b.name || b.branch_name || '');
          if (!name) continue;
          if (!seen.has(name)) {
            seen.add(name);
            const label = shortRepo ? `${escHtml(name)}  [${escHtml(shortRepo)}]` : escHtml(name);
            datalist.innerHTML += `<option value="${escHtml(name)}">${label}</option>`;
          }
        }
      } catch (_) {
        // 分支获取失败不影响主流程
      }
    }
  }

  /** 从 Git repo URL 提取简短标识（如 gitlab:owner/repo） */
  function extractRepoLabel(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\.git$/, '').replace(/^\//, '');
      const parts = path.split('/');
      if (parts.length >= 2) return parts.slice(-2).join('/');
      return u.hostname;
    } catch (_) { return ''; }
  }

  // ---- Tabs ----
  function bindTabs() {
    $$('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        $$('.tab').forEach((x) => x.classList.remove('active'));
        $$('.tab-content').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const c = $(`#tab-${t.dataset.tab}`);
        if (c) c.classList.add('active');
        if (t.dataset.tab === 'single') refreshRequestList();
        if (t.dataset.tab === 'batch') refreshCapturedCount();
        if (t.dataset.tab === 'errors') refreshErrorList();
        if (t.dataset.tab === 'history') refreshHistory();
      });
    });
  }

  // ================================================================
  //  Tab 1: 单请求创建 (含搜索/过滤)
  // ================================================================

  function bindSingleTab() {
    $('#btnRefreshRequest').addEventListener('click', refreshRequestList);
    // 搜索 & 过滤 — 实时过滤本地列表
    $('#requestSearch').addEventListener('input', applyRequestFilters);
    $('#requestMethodFilter').addEventListener('change', applyRequestFilters);
    $('#requestStatusFilter').addEventListener('change', applyRequestFilters);
    $('#singleWorkspace').addEventListener('change', onSingleWorkspaceChange);
    $('#singleWorkBranch').addEventListener('change', () => handleBranchInputChange('singleWorkBranch', 'work', 'singleTaskTitle'));
    $('#singleMergeTarget').addEventListener('change', () => handleBranchInputChange('singleMergeTarget', 'merge'));
    $('#btnRefreshSingleBranches').addEventListener('click', () => {
      const wsId = $('#singleWorkspace').value;
      const checkedIds = getSelectedProjectIds('singleProjects');
      fetchSingleBranchLists(wsId, checkedIds);
    });
    $('#btnCreateSingle').addEventListener('click', createSingleTask);
    $('#btnPickElement')?.addEventListener('click', startPageElementPick);
    $('#singleFeatureParamsSource')?.addEventListener('change', onFeatureParamsSourceChange);
    initSingleDueDateDefault();
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'elementPickResult' && msg.block) {
        appendElementPickBlock(msg.block);
      }
    });
    // 项目勾选变化时，动态获取分支列表
    $('#singleProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = $('#singleWorkspace').value;
        const checkedIds = getSelectedProjectIds('singleProjects');
        fetchSingleBranchLists(wsId, checkedIds);
        refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
      }
    });
  }

  function appendElementPickBlock(block) {
    const ta = $('#singleTaskDesc');
    if (!ta || !block) return;
    const base = (ta.value || '').trimEnd();
    ta.value = base ? `${base}\n\n${block}` : block;
    showR('singleResult', 'success', '✅ 已将页面元素调整加入任务描述');
    console.log('[taskChromePlugin] panel received elementPickResult, len=', block.length);
  }

  async function startPageElementPick() {
    const tabId = chrome.devtools?.inspectedWindow?.tabId;
    if (!tabId) {
      showR('singleResult', 'error', '无法获取当前检查页 tabId');
      return;
    }
    const btn = $('#btnPickElement');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '选择中…';
    }
    try {
      const r = await sendMessage({
        action: 'startElementPick',
        tabId,
        source: 'devtools',
      });
      if (!r?.success) {
        const err = new Error(r?.error || '启动失败');
        const tid = extractTraceId(r);
        if (tid) err.traceId = tid;
        throw err;
      }
      showR('singleResult', 'success', '请在页面中点击目标元素（Esc 取消）');
    } catch (e) {
      showR('singleResult', 'error', `无法启动指针选择: ${e.message}`, e.traceId);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🖱️ 指针选择';
      }
    }
  }

  async function refreshRequestList() {
    // 数据由 devtools.js 通过 postMessage 实时推送，这里只需重新过滤
    applyRequestFilters();
  }

  function setRequestLoading(loading) {
    const el = $('#selectedRequest');
    if (!el) return;
    if (loading && recentRequests.length === 0 && !requestListBootstrapped) {
      el.innerHTML = '<p class="placeholder">⏳ 加载中...</p>';
      el.classList.add('empty');
      return;
    }
    // loading=false 或已有数据：必须刷新，清除 HTML 初始「正在加载请求列表...」
    applyRequestFilters();
  }

  /**
   * 前端实时过滤 — 按搜索文本 + 方法 + 状态码
   */
  function applyRequestFilters() {
    requestListBootstrapped = true;
    const search = ($('#requestSearch')?.value || '').toLowerCase();
    const method = $('#requestMethodFilter')?.value || '';
    const status = $('#requestStatusFilter')?.value || '';

    let filtered = recentRequests.filter((r) => {
      // 搜索：匹配 URL 或方法或状态码
      if (search) {
        const url = (r.url || '').toLowerCase();
        const m = (r.method || '').toLowerCase();
        const sc = String(r.statusCode || '');
        const canceledLabel = isRequestCanceled(r) ? 'canceled' : '';
        if (!url.includes(search) && !m.includes(search) && !sc.includes(search) && !canceledLabel.includes(search)) {
          return false;
        }
      }
      // 方法过滤
      if (method && r.method !== method) return false;
      // 状态码过滤
      if (status === 'canceled' && !isRequestCanceled(r)) return false;
      if (status === '2xx' && !(r.statusCode >= 200 && r.statusCode < 300)) return false;
      if (status === '3xx' && !(r.statusCode >= 300 && r.statusCode < 400)) return false;
      if (status === '4xx' && !(r.statusCode >= 400 && r.statusCode < 500)) return false;
      if (status === '5xx' && !(r.statusCode >= 500 && r.statusCode < 600)) return false;
      return true;
    });

    // 按时间倒序
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    renderRequestList(filtered.slice(0, 100));
    const countEl = $('#requestCount');
    if (countEl) countEl.textContent = `共 ${filtered.length} 条`;
  }

  function renderRequestList(requests) {
    const container = $('#selectedRequest');
    if (!container) return;
    if (requests.length === 0) {
      container.innerHTML = `<div class="empty-state">
        <p class="placeholder">暂无匹配的请求</p>
        <p class="hint">打开任意网页，DevTools Network 面板中的请求将自动出现在这里</p>
      </div>`;
      container.classList.add('empty');
      return;
    }
    container.classList.remove('empty');

    let html = '<div class="request-list">';
    for (const req of requests) {
      const sc = getRequestStatusClass(req);
      const statusLabel = formatRequestStatusLabel(req);
      const sel = selectedRequest?.id === req.id ? ' selected' : '';
      const urlShort = (req.url || '').length > 100 ? req.url.slice(0, 100) + '...' : req.url;
      html += `<div class="request-item${sel}" data-id="${req.id}">
        <span class="req-method ${req.method}">${req.method}</span>
        <span class="req-status ${sc}">${statusLabel}</span>
        <span class="req-url" title="${escHtml(req.url)}">${escHtml(urlShort)}</span>
        <span class="req-time">${req.time || '?'}ms</span>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.request-item').forEach((el) => {
      el.addEventListener('click', () => {
        const r = recentRequests.find((x) => x.id === el.dataset.id);
        if (r) selectRequest(r);
      });
    });
  }

  function selectRequest(req) {
    selectedRequest = req;
    $$('.request-item').forEach((x) => x.classList.remove('selected'));
    const tgt = document.querySelector(`.request-item[data-id="${req.id}"]`);
    if (tgt) tgt.classList.add('selected');
    fillRequestDetail(req);
  }

  function fillRequestDetail(req) {
    // 自动填充标题
    let p = ''; try { p = new URL(req.url).pathname; } catch (_) { p = req.url; }
    $('#singleTaskTitle').value = `[${req.method}] ${p} → ${formatRequestStatusLabel(req)}`;

    // 自动填充描述（每次切换都更新 — 含完整的请求/响应头体）
    let d = `**请求**: ${req.method} ${req.url}\n**状态码**: ${formatRequestStatusLabel(req)} ${req.statusText || ''}\n**耗时**: ${req.time || '?'}ms`;
    if (isRequestCanceled(req) && req.error) {
      d += `\n**错误**: ${req.error}`;
    }
    // 响应体
    if (req.responseBody) d += `\n\n**响应体**:\n\`\`\`\n${String(req.responseBody)}\n\`\`\``;
    // 响应头
    if (req.responseHeaders && Object.keys(req.responseHeaders).length) {
      d += `\n\n**响应头**:\n\`\`\`\n${Object.entries(req.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
    }
    // 请求体
    if (req.requestBody) d += `\n\n**请求体**:\n\`\`\`\n${String(req.requestBody)}\n\`\`\``;
    // 请求头
    if (req.requestHeaders && Object.keys(req.requestHeaders).length) {
      d += `\n\n**请求头**:\n\`\`\`\n${Object.entries(req.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
    }
    $('#singleTaskDesc').value = d;
    if (!$('#singleWorkspace').value) {
      loadWorkspaces('singleWorkspace');
    }
    // 自动填充工作分支名（若未手动填写）
    if (!$('#singleWorkBranch').value) {
      const pathname = p.replace(/\//g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const status = req.statusCode;
      const prefix = status >= 500 ? 'fix' : (status >= 400 ? 'fix' : 'feat');
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      $('#singleWorkBranch').value = `${prefix}/${today}_devtools_aidev\${taskId}_${pathname}`;
    }
    // 自动填充合并目标分支（若未手动填写）
    if (!$('#singleMergeTarget').value) {
      $('#singleMergeTarget').value = 'main';
    }
  }

  // ---- Workspace / Projects ----
  function setPanelAidevStatus(text, visible = true) {
    const el = $('#panel-aidev-status');
    if (!el) return;
    if (!visible || !text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.hidden = false;
  }

  function checkPanelAidevMatchingProjects(containerId, wsId) {
    if (!pendingAidevMatches?.length || typeof AidevMeta === 'undefined') return;
    const pids = AidevMeta.projectIdsForWorkspace(pendingAidevMatches, wsId);
    if (!pids.length) return;
    const c = $(`#${containerId}`);
    if (!c) return;
    for (const cb of c.querySelectorAll('.project-check')) {
      if (pids.includes(String(cb.value))) cb.checked = true;
    }
  }

  async function applyAidevMetaAfterWorkspacesLoaded(selectId) {
    pendingAidevMatches = null;
    if (typeof AidevMeta === 'undefined') {
      setPanelAidevStatus('', false);
      return null;
    }

    const meta = await AidevMeta.readAidevMetaFromInspectedWindow();
    if (!meta?.service_id) {
      setPanelAidevStatus('', false);
      return null;
    }

    if (selectId !== 'singleWorkspace') return null;

    try {
      const resp = await swApi('resolveAidevMeta', { serviceId: meta.service_id });
      const matches = Array.isArray(resp?.matches) ? resp.matches : [];
      setPanelAidevStatus(AidevMeta.formatAidevResolveStatus(matches));
      if (!matches.length) return null;

      pendingAidevMatches = matches;
      const wsIds = AidevMeta.uniqueWorkspaceIdsFromMatches(matches);
      return wsIds.length === 1 ? wsIds[0] : null;
    } catch (e) {
      console.warn('[taskChromePlugin] panel aidev resolve:', e.message);
      setPanelAidevStatus(`元信息反查失败: ${e.message}`);
      return null;
    }
  }

  async function loadWorkspaces(selectId) {
    const sel = $(`#${selectId}`);
    if (!sel) return;
    if (!(await ensureApiReady())) {
      sel.innerHTML = `<option value="">-- ${apiConfig.token ? '会话过期，请重新登录' : '请先登录'} --</option>`;
      return;
    }
    sel.innerHTML = '<option value="">加载中...</option>';
    try {
      const data = await swApi('getWorkspaces');
      workspaces = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      renderWorkspaceOptions(selectId);
      const aidevWsId = await applyAidevMetaAfterWorkspacesLoaded(selectId);
      if (aidevWsId && workspaces.some((w) => String(w.id || w._id) === String(aidevWsId))) {
        sel.value = aidevWsId;
      } else {
        const last = await Storage.getLastWorkspace();
        if (last && workspaces.some((w) => (w.id || w._id) === last)) {
          sel.value = last;
        } else if (workspaces.length === 1) {
          sel.value = workspaces[0].id || workspaces[0]._id;
        }
      }
      sel.dispatchEvent(new Event('change'));
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">-- 请在扩展中重新登录 --</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  }

  function renderWorkspaceOptions(selectId) {
    const sel = $(`#${selectId}`);
    sel.innerHTML = '<option value="">-- 请选择工作空间 --</option>';
    for (const ws of workspaces) {
      const id = ws.id || ws._id;
      sel.innerHTML += `<option value="${id}">${escHtml(ws.name || ws.displayName || ws.title || id)}</option>`;
    }
  }

  async function onSingleWorkspaceChange() {
    const wsId = $('#singleWorkspace').value;
    await Storage.saveLastWorkspace(wsId);
    if (!wsId) {
      $('#singleProjects').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      $('#singleOwner').innerHTML = '<option value="">请先选择工作空间</option>';
      $('#singleProgressColumn').innerHTML = '<option value="">请先选择工作空间</option>';
      $('#singleDeliverable').innerHTML = '<option value="">请先选择工作空间</option>';
      $('#singleAssignees').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      if ($('#singleRepoBases')) {
        $('#singleRepoBases').innerHTML = '<p class="placeholder">勾选项目后按仓库填写基准分支</p>';
      }
      fetchAndPopulateBranches('singleWorkBranchList', '', [], 'work');
      fetchAndPopulateBranches('singleMergeTargetList', '', [], 'merge');
      return;
    }
    const ws = workspaces.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    await loadProjects(wsId, 'singleProjects', companyId);
    if (companyId) {
      await loadMembers(String(companyId));
      await loadProgressColumns(String(companyId), wsId, 'singleProgressColumn');
      await loadDeliverableTypes(String(companyId), wsId);
      await loadInstalledImages(String(companyId));
    }
    await loadPersonalFeatureParamsConfigs();
    initSingleDueDateDefault();
    // 恢复选中后加载分支
    const checkedIds = getSelectedProjectIds('singleProjects');
    if (checkedIds.length) {
      fetchSingleBranchLists(wsId, checkedIds);
    } else {
      fetchAndPopulateBranches('singleWorkBranchList', wsId, [], 'work');
      fetchAndPopulateBranches('singleMergeTargetList', wsId, [], 'merge');
    }
    refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
  }

  function initSingleDueDateDefault() {
    initDueDateDefault('singleDueDate');
  }

  async function loadDeliverableTypes(companyId, wsId) {
    return loadDeliverableTypesInto('singleDeliverable', companyId, wsId);
  }

  async function loadInstalledImages(companyId) {
    return loadInstalledImagesInto('singleContainerImage', companyId);
  }

  async function loadPersonalFeatureParamsConfigs() {
    return loadPersonalFeatureParamsInto('singlePersonalConfig');
  }

  function onFeatureParamsSourceChange() {
    const source = $('#singleFeatureParamsSource')?.value || '';
    const wrap = $('#singlePersonalConfigWrap');
    if (wrap) wrap.hidden = source !== 'personal';
  }

  function renderAssigneeCheckboxes(companyId) {
    const box = $('#singleAssignees');
    if (!box) return;
    const members = membersCache[companyId] || [];
    if (!members.length) {
      box.innerHTML = '<p class="placeholder">暂无成员</p>';
      return;
    }
    let h = '';
    for (const m of members) {
      const mid = String(m.id);
      const name = m.member_name || m.name || mid;
      h += `<label><input type="checkbox" class="assignee-check" value="${escHtml(mid)}"> ${escHtml(name)}</label>`;
    }
    box.innerHTML = h;
  }

  function getSelectedAssigneeIds() {
    return Array.from(document.querySelectorAll('#singleAssignees .assignee-check:checked')).map((cb) => cb.value);
  }

  function refreshRepoBaseEditors(repoContainerId, projectsContainerId, wsId) {
    const box = $(`#${repoContainerId}`);
    if (!box) return;
    const prev = CreateTaskPayload.readRepoBaseBranchesFromRoot(box);
    const ids = getSelectedProjectIds(projectsContainerId);
    const list = projectsCache[wsId] || [];
    box.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
      projectIds: ids,
      projectsList: list,
      previousValues: prev,
      inputClass: 'form-input',
      emptyHint: '勾选项目后按仓库填写基准分支',
    });
  }

  function initDueDateDefault(inputId) {
    const el = $(`#${inputId}`);
    if (!el || el.value) return;
    if (typeof CreateTaskPayload !== 'undefined') {
      el.value = CreateTaskPayload.getDefaultTaskDeadline();
    }
  }

  async function loadDeliverableTypesInto(selectId, companyId, wsId) {
    const sel = $(`#${selectId}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await swApi('getDeliverableTypes', { companyId, workspaceId: wsId });
      const types = data?.current_deliverable_objs || [];
      sel.innerHTML = types.length
        ? types.map((t) => `<option value="${escHtml(String(t.id))}">${escHtml(t.name || t.id)}</option>`).join('')
        : '<option value="">无可用交付物类别</option>';
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${escHtml(e.message)}</option>`;
    }
  }

  async function loadInstalledImagesInto(selectId, companyId) {
    const sel = $(`#${selectId}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await swApi('getInstalledImages', { companyId });
      const images = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      let h = '<option value="">无</option>';
      for (const img of images) {
        const iid = img.id || img._id;
        const label = `${img.name || iid}:${img.version || img.tag || 'latest'}`;
        h += `<option value="${escHtml(String(iid))}">${escHtml(label)}</option>`;
      }
      sel.innerHTML = h;
      if (images.length === 1) sel.value = String(images[0].id || images[0]._id);
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${escHtml(e.message)}</option>`;
    }
  }

  async function loadPersonalFeatureParamsInto(selectId) {
    const sel = $(`#${selectId}`);
    if (!sel) return;
    if (!(await ensureApiReady())) return;
    try {
      const data = await swApi('getPersonalFeatureParamsConfigs');
      const configs = data?.configs || (Array.isArray(data) ? data : []);
      let h = '<option value="">-- 请选择个人配置 --</option>';
      for (const c of configs) {
        const cid = c.id || c._id;
        h += `<option value="${escHtml(String(cid))}">${escHtml(c.name || c.title || cid)}</option>`;
      }
      sel.innerHTML = h;
    } catch (e) {
      console.warn('[taskChromePlugin] loadPersonalFeatureParamsInto:', e.message);
      sel.innerHTML = `<option value="">加载失败: ${escHtml(e.message)}</option>`;
    }
  }

  async function loadProjects(wsId, containerId, companyId) {
    const c = $(`#${containerId}`);
    c.innerHTML = '<p class="placeholder">加载中...</p>';
    if (!(await ensureApiReady())) {
      c.innerHTML = '<p class="placeholder">请先登录</p>';
      return;
    }
    if (projectsCache[wsId]) {
      renderProjectCheckboxes(containerId, projectsCache[wsId]);
      checkPanelAidevMatchingProjects(containerId, wsId);
      return;
    }
    try {
      const data = await swApi('getProjects', { workspaceId: wsId, companyId });
      const projs = Array.isArray(data) ? data : (data?.items || data?.data || []);
      projectsCache[wsId] = projs;
      renderProjectCheckboxes(containerId, projs);
      checkPanelAidevMatchingProjects(containerId, wsId);
    } catch (e) {
      if (handleApiAuthFailure(e)) {
        c.innerHTML = '<p class="placeholder">请重新登录</p>';
        return;
      }
      c.innerHTML = `<p class="placeholder">加载失败: ${e.message}</p>`;
    }
  }

  function renderProjectCheckboxes(containerId, projects) {
    const c = $(`#${containerId}`);
    if (!projects.length) { c.innerHTML = '<p class="placeholder">该项目空间下暂无项目</p>'; return; }
    let h = `<div class="select-all-row"><label><input type="checkbox" class="select-all" data-container="${containerId}"> 全选/取消</label></div>`;
    for (const p of projects) {
      const id = p.id || p._id;
      h += `<label><input type="checkbox" value="${id}" class="project-check"> ${escHtml(p.name || p.displayName || p.title || id)}</label>`;
    }
    c.innerHTML = h;
    c.querySelector('.select-all').addEventListener('change', (e) => {
      const ck = e.target.checked;
      c.querySelectorAll('.project-check').forEach((cb) => { cb.checked = ck; });
    });
    restoreProjectSelection(containerId);
  }

  async function restoreProjectSelection(cid) {
    const ids = await Storage.getLastProjectIds();
    if (!ids.length) return;
    $(`#${cid}`).querySelectorAll('.project-check').forEach((cb) => { if (ids.includes(cb.value)) cb.checked = true; });
  }

  function getSelectedProjectIds(cid) {
    return Array.from($(`#${cid}`).querySelectorAll('.project-check:checked')).map((cb) => cb.value);
  }

  async function createSingleTask() {
    const wsId = $('#singleWorkspace').value;
    const checkedIds = getSelectedProjectIds('singleProjects');
    const cached = projectsCache[wsId] || [];
    const title = $('#singleTaskTitle').value.trim();
    const desc = $('#singleTaskDesc').value.trim();
    const priority = $('#singlePriority').value;
    const owner = $('#singleOwner').value.trim();
    const progressColumnId = $('#singleProgressColumn').value;
    const workBranch = ($('#singleWorkBranch').value || '').trim();
    const mergeTarget = ($('#singleMergeTarget').value || '').trim();
    const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot($('#singleRepoBases'));
    const deliverableObjId = ($('#singleDeliverable').value || '').trim();
    const containerImageId = ($('#singleContainerImage').value || '').trim();
    const featureParamsSource = ($('#singleFeatureParamsSource').value || '').trim();
    const personalConfigId = ($('#singlePersonalConfig').value || '').trim();
    const dueDate = ($('#singleDueDate').value || '').trim();
    const autoRun = Boolean($('#singleAutoRun')?.checked);
    const assignees = getSelectedAssigneeIds();

    if (!wsId) return showR('singleResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return showR('singleResult', 'error', '请勾选至少一个项目');
    if (!title) return showR('singleResult', 'error', '请输入任务标题');
    if (!owner) return showR('singleResult', 'error', '请填写 Owner (CompanyMember.id)，可在端点映射中配置默认值');
    if (!selectedRequest) return showR('singleResult', 'error', '请从请求列表中选择一个请求');
    if (!(await ensureApiReady())) return showR('singleResult', 'error', '请先登录或会话已过期');

    const form = {
      title,
      description: desc,
      priority,
      workspaceId: wsId,
      owner,
      assignees,
      progress_column_id: progressColumnId,
      deliverable_obj_id: deliverableObjId,
      container_image_id: containerImageId,
      due_date: dueDate,
      auto_run: autoRun,
      feature_params_source: featureParamsSource,
      personal_feature_params_config_id: personalConfigId,
      workBranch,
      mergeTarget,
      repoBaseBranches,
      projectIds: checkedIds,
      projectsList: cached,
    };
    const blocked = CreateTaskPayload.validateCreateTaskForm(form);
    if (blocked) return showR('singleResult', 'error', blocked);

    const btn = $('#btnCreateSingle');
    btn.disabled = true; btn.textContent = '创建中...';
    try {
      await Storage.saveLastProjectIds(checkedIds);
      const mapping = await sendMessage({ action: 'getEndpointMapping' });
      const taskData = CreateTaskPayload.buildCreateTaskPayload(form);
      const r = await sendMessage({
        action: 'createTask', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        taskData,
      });
      if (!r.success) {
        const err = new Error(r.error);
        const tid = extractTraceId(r);
        if (tid) err.traceId = tid;
        throw err;
      }
      showR('singleResult', 'success', `✅ 任务创建成功! ID: ${r.data?.id || r.data?._id || '(已创建)'}`);
    } catch (e) {
      showR('singleResult', 'error', `❌ 创建失败: ${e.message}`, e.traceId);
    } finally { btn.disabled = false; btn.textContent = '✅ 创建任务'; }
  }

  // ================================================================
  //  Tab 2: 批量错误捕获
  // ================================================================

  function bindBatchTab() {
    $('#captureToggle').addEventListener('change', onCaptureToggle);
    $('#batchWorkspace').addEventListener('change', onBatchWsChange);
    $('#batchWorkBranch').addEventListener('change', () => handleBranchInputChange('batchWorkBranch', 'work'));
    $('#batchMergeTarget').addEventListener('change', () => handleBranchInputChange('batchMergeTarget', 'merge'));
    $('#btnRefreshBatchBranches').addEventListener('click', () => {
      const wsId = $('#batchWorkspace').value;
      const checkedIds = getSelectedProjectIds('batchProjects');
      fetchBatchBranchLists(wsId, checkedIds);
    });
    $('#btnRefreshErrors').addEventListener('click', refreshCapturedCount);
    $('#batchFeatureParamsSource')?.addEventListener('change', onBatchFeatureParamsSourceChange);
    // 项目勾选变化时，动态获取分支列表 + 逐仓基准分支
    $('#batchProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = $('#batchWorkspace').value;
        const checkedIds = getSelectedProjectIds('batchProjects');
        fetchBatchBranchLists(wsId, checkedIds);
        refreshRepoBaseEditors('batchRepoBases', 'batchProjects', wsId);
      }
    });
    $('#btnClearErrors').addEventListener('click', clearCapturedErrors);
    $('#btnCreateBatch').addEventListener('click', createBatchTasks);
    initDueDateDefault('batchDueDate');
    loadCaptureConfig();
    loadWorkspaces('batchWorkspace');
    refreshCapturedCount();
  }

  async function loadCaptureConfig() {
    const cfg = await Storage.getCaptureConfig();
    $('#captureToggle').checked = cfg.enabled;
    updateCaptureStatus(cfg.enabled);
    if (cfg.statusCodes) {
      $('#statusCodeFilters').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = cfg.statusCodes.includes(cb.value);
      });
    }
  }

  async function onCaptureToggle() {
    const en = $('#captureToggle').checked;
    const codes = Array.from($('#statusCodeFilters').querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    try {
      await sendMessage({ action: 'setCaptureEnabled', enabled: en, statusCodes: codes });
    } catch (_) { /* ignore */ }
    updateCaptureStatus(en);
  }

  function updateCaptureStatus(en) { $('#captureStatus').textContent = en ? '🔴 自动捕获中...' : '⏸️ 捕获已停止'; }

  async function refreshCapturedCount() {
    try {
      const r = await sendMessage({ action: 'getCapturedErrors' });
      const all = r?.success ? (r.data || []) : [];
      // 示数仅计 5xx；总捕获条数另注（可含 2xx/4xx/Canceled）
      const n5xx = CaptureStatus.filterBadgeCountableRequests(all).length;
      const nAll = all.length;
      const el = $('#capturedCount');
      if (el) {
        el.style.display = 'inline';
        el.innerHTML = ` | 5xx 示数: <strong>${n5xx}</strong>${nAll !== n5xx ? `（总捕获 ${nAll}）` : ''} 条`;
      }
    } catch (_) { /* ignore */ }
  }

  async function clearCapturedErrors() {
    try {
      await sendMessage({ action: 'clearCapturedErrors' });
    } catch (_) { /* ignore */ }
    await refreshCapturedCount();
    showR('batchResult', 'success', '✅ 已清空');
  }

  async function onBatchWsChange() {
    const id = $('#batchWorkspace').value;
    await Storage.saveLastWorkspace(id);
    if (!id) {
      $('#batchProjects').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      $('#batchProgressColumn').innerHTML = '<option value="">请先选择工作空间</option>';
      if ($('#batchDeliverable')) $('#batchDeliverable').innerHTML = '<option value="">请先选择工作空间</option>';
      if ($('#batchRepoBases')) {
        $('#batchRepoBases').innerHTML = '<p class="placeholder">勾选项目后按仓库填写基准分支</p>';
      }
      fetchAndPopulateBranches('batchWorkBranchList', '', [], 'work');
      fetchAndPopulateBranches('batchMergeTargetList', '', [], 'merge');
      return;
    }
    const ws = workspaces.find(w => (w.id || w._id) === id);
    const companyId = ws?.company_id || ws?.companyId;
    await loadProjects(id, 'batchProjects', companyId);
    if (companyId) {
      await loadProgressColumns(String(companyId), id, 'batchProgressColumn');
      await loadDeliverableTypesInto('batchDeliverable', String(companyId), id);
      await loadInstalledImagesInto('batchContainerImage', String(companyId));
    }
    await loadPersonalFeatureParamsInto('batchPersonalConfig');
    initDueDateDefault('batchDueDate');
    // 恢复选中后加载分支
    const checkedIds = getSelectedProjectIds('batchProjects');
    if (checkedIds.length) {
      fetchBatchBranchLists(id, checkedIds);
    } else {
      fetchAndPopulateBranches('batchWorkBranchList', id, [], 'work');
      fetchAndPopulateBranches('batchMergeTargetList', id, [], 'merge');
    }
    refreshRepoBaseEditors('batchRepoBases', 'batchProjects', id);
  }

  function onBatchFeatureParamsSourceChange() {
    const source = $('#batchFeatureParamsSource')?.value || '';
    const wrap = $('#batchPersonalConfigWrap');
    if (wrap) wrap.hidden = source !== 'personal';
  }

  async function createBatchTasks() {
    const wsId = $('#batchWorkspace').value;
    const checkedIds = getSelectedProjectIds('batchProjects');
    const progressColumnId = $('#batchProgressColumn').value;
    const workBranch = ($('#batchWorkBranch').value || '').trim();
    const mergeTarget = ($('#batchMergeTarget').value || '').trim();
    const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot($('#batchRepoBases'));
    const deliverableObjId = ($('#batchDeliverable')?.value || '').trim();
    const containerImageId = ($('#batchContainerImage')?.value || '').trim();
    const featureParamsSource = ($('#batchFeatureParamsSource')?.value || '').trim();
    const personalConfigId = ($('#batchPersonalConfig')?.value || '').trim();
    const dueDate = ($('#batchDueDate')?.value || '').trim();
    const autoRun = Boolean($('#batchAutoRun')?.checked);

    if (!wsId) return showR('batchResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return showR('batchResult', 'error', '请勾选至少一个项目');
    if (!(await ensureApiReady())) return showR('batchResult', 'error', '请先登录或会话已过期');

    const featureGate = CreateTaskPayload.validateCreateTaskForm({
      title: 'batch',
      workspaceId: wsId,
      owner: 'pending',
      projectIds: checkedIds,
      feature_params_source: featureParamsSource,
      personal_feature_params_config_id: personalConfigId,
    });
    if (featureGate && /环境变量参数/.test(featureGate)) {
      return showR('batchResult', 'error', featureGate);
    }

    const cached = projectsCache[wsId] || [];
    const projects = CreateTaskPayload.buildProjectsFromSelection({
      projectIds: checkedIds,
      projectsList: cached,
      workBranch,
      repoBaseBranches,
    });

    const r = await sendMessage({ action: 'getCapturedErrors' });
    if (!r.success || !r.data?.length) return showR('batchResult', 'error', '没有捕获到错误请求');

    // 批量建任务仅针对 5xx（与插件角标示数一致）
    const errors = CaptureStatus.filterBadgeCountableRequests(r.data);
    if (!errors.length) {
      return showR('batchResult', 'error', '没有可建任务的 5xx 请求（示数仅计 5xx）');
    }
    const btn = $('#btnCreateBatch');
    btn.disabled = true; btn.textContent = `创建中 (${errors.length})...`;
    try {
      await Storage.saveLastProjectIds(checkedIds);
      const tasks = errors.map((e) => {
        const statusLabel = e.canceled || e.statusCode === 0 ? 'Canceled' : String(e.statusCode);
        let desc = `**自动捕获**\n- URL: ${e.url}\n- 方法: ${e.method}\n- 状态码: ${statusLabel} ${e.statusLine || ''}\n- 时间: ${new Date(e.capturedAt || e.timeStamp).toISOString()}`;
        if (e.error) desc += `\n- 错误: ${e.error}`;
        if (e.responseHeaders && Object.keys(e.responseHeaders).length) {
          desc += `\n\n**响应头**:\n\`\`\`\n${Object.entries(e.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
        }
        if (e.requestHeaders && Object.keys(e.requestHeaders).length) {
          desc += `\n\n**请求头**:\n\`\`\`\n${Object.entries(e.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
        }
        return CreateTaskPayload.buildCreateTaskPayload({
          title: `[${e.method}] ${extractPath(e.url)} → ${statusLabel}`,
          description: desc,
          priority: e.canceled || e.statusCode === 0 ? 'medium' : (e.statusCode >= 500 ? 'high' : 'medium'),
          workspaceId: wsId,
          projects,
          progress_column_id: progressColumnId,
          deliverable_obj_id: deliverableObjId,
          container_image_id: containerImageId,
          due_date: dueDate,
          auto_run: autoRun,
          feature_params_source: featureParamsSource,
          personal_feature_params_config_id: personalConfigId,
          workBranch,
          mergeTarget,
          owner: $('#singleOwner')?.value || undefined,
        });
      });
      const mapping = await sendMessage({ action: 'getEndpointMapping' });
      const b = await sendMessage({
        action: 'createTasksBatch', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        tasksData: tasks,
      });
      if (!b.success) {
        const err = new Error(b.error);
        const tid = extractTraceId(b);
        if (tid) err.traceId = tid;
        throw err;
      }
      showR('batchResult', 'success', `✅ 批量创建完成! 共 ${tasks.length} 个任务`);
      await sendMessage({ action: 'clearCapturedErrors' });
      await refreshCapturedCount();
    } catch (e) {
      showR('batchResult', 'error', `❌ 失败: ${e.message}`, e.traceId);
    } finally { btn.disabled = false; btn.textContent = '📦 批量创建任务'; }
  }

  // ================================================================
  //  Tab 3: 错误列表
  // ================================================================

  function bindErrorListTab() {
    $('#btnRefreshErrorList').addEventListener('click', refreshErrorList);
    $('#btnClearErrorList').addEventListener('click', async () => {
      await sendMessage({ action: 'clearCapturedErrors' });
      await refreshErrorList();
    });
  }

  async function refreshErrorList() {
    const c = $('#errorList');
    try {
      const r = await sendMessage({ action: 'getCapturedErrors' });
      const only5xx = CaptureStatus.filterBadgeCountableRequests(r?.success ? (r.data || []) : []);
      if (!only5xx.length) { c.innerHTML = '<p class="placeholder">暂无 5xx 错误请求（示数仅计 5xx）</p>'; return; }
      let h = '';
      for (const e of [...only5xx].reverse()) {
        const s = (e.url || '').length > 100 ? e.url.slice(0, 100) + '...' : e.url;
        h += `<div class="error-item">
          <div class="err-url"><span class="req-method ${e.method}">${e.method}</span><span class="err-status">${e.canceled ? 'Canceled' : e.statusCode}</span>${escHtml(s)}</div>
          <div class="err-meta"><span>${e.type}</span><span>${new Date(e.capturedAt).toLocaleString()}</span></div>
        </div>`;
      }
      c.innerHTML = h;
    } catch (_) { c.innerHTML = '<p class="placeholder">加载失败</p>'; }
  }

  // ================================================================
  //  Tab 4: 历史记录 & 重试
  // ================================================================

  function bindHistoryTab() {
    $('#btnRefreshHistory').addEventListener('click', refreshHistory);
    $('#btnClearHistory').addEventListener('click', async () => {
      await sendMessage({ action: 'clearTaskHistory' });
      await refreshHistory();
    });
    $('#btnRetryAllFailed').addEventListener('click', retryAllFailed);
  }

  async function refreshHistory() {
    const c = $('#historyList');
    const statsEl = $('#historyStats');
    const retryBtn = $('#btnRetryAllFailed');

    try {
      const r = await sendMessage({ action: 'getTaskHistory' });
      if (!r.success || !r.data?.length) {
        c.innerHTML = '<p class="placeholder">暂无创建记录</p>';
        statsEl.innerHTML = '';
        retryBtn.style.display = 'none';
        return;
      }

      const history = [...r.data].reverse();
      const total = history.length;
      const success = history.filter((h) => h.status === 'success').length;
      const failed = history.filter((h) => h.status === 'failed').length;

      statsEl.innerHTML = `
        <span class="stat stat-total">总计: ${total}</span>
        <span class="stat stat-success">成功: ${success}</span>
        <span class="stat stat-failed">失败: ${failed}</span>`;
      retryBtn.style.display = failed > 0 ? '' : 'none';

      let h = '';
      for (const item of history) {
        const sc = item.status === 'success' ? 'success' : (item.status === 'failed' ? 'failed' : 'pending');
        const icon = item.type === 'batch' ? '📦' : '📋';
        const timeStr = new Date(item.createdAt).toLocaleString();
        const retries = item.retryCount ? `<span class="retry-badge">重试×${item.retryCount}</span>` : '';

        h += `<div class="history-item">
          <div class="hi-header">
            <span class="hi-title">${icon} ${escHtml(item.title)}${retries}</span>
            <span class="hi-status ${sc}">${item.status === 'success' ? '成功' : (item.status === 'failed' ? '失败' : '处理中')}</span>
          </div>
          <div class="hi-meta">
            <span>类型: ${item.type === 'batch' ? `批量(${item.count || '?'}个)` : '单个'}</span>
            <span>时间: ${timeStr}</span>
            ${item.resultId ? `<span>ID: ${item.resultId}</span>` : ''}
          </div>
          ${item.error ? `<div class="hi-error">${escHtml(item.error)}</div>` : ''}
          <div class="hi-actions">`;

        if (item.status === 'failed') {
          h += `<button class="btn btn-sm retry-single" data-id="${item.id}">🔁 重试</button>`;
        }
        h += `<button class="btn btn-sm copy-task" data-id="${item.id}">📋 复制数据</button>
          </div></div>`;
      }
      c.innerHTML = h;

      // 绑定重试按钮
      c.querySelectorAll('.retry-single').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await retrySingleTask(btn.dataset.id);
        });
      });
      // 绑定复制按钮
      c.querySelectorAll('.copy-task').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await copyTaskData(btn.dataset.id);
        });
      });
    } catch (_) { c.innerHTML = '<p class="placeholder">加载失败</p>'; }
  }

  async function retrySingleTask(recordId) {
    const r = await sendMessage({ action: 'getTaskHistory' });
    if (!r.success) return;
    const record = r.data.find((h) => h.id === recordId);
    if (!record || !record.taskData) return showR('historyResult', 'error', '无法找到任务数据');

    const btn = document.querySelector(`.retry-single[data-id="${recordId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '重试中...'; }

    try {
      const mapping = await sendMessage({ action: 'getEndpointMapping' });
      if (record.type === 'batch') {
        const res = await sendMessage({
          action: 'createTasksBatch', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
          endpointMapping: mapping.success ? mapping.data : undefined,
          tasksData: record.tasksData || record.taskData,
        });
        if (!res.success) {
          const err = new Error(res.error);
          const tid = extractTraceId(res);
          if (tid) err.traceId = tid;
          throw err;
        }
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      } else {
        const res = await sendMessage({
          action: 'createTask', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
          endpointMapping: mapping.success ? mapping.data : undefined,
          taskData: record.taskData,
        });
        if (!res.success) {
          const err = new Error(res.error);
          const tid = extractTraceId(res);
          if (tid) err.traceId = tid;
          throw err;
        }
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      }
      showR('historyResult', 'success', '✅ 重试成功!');
      await refreshHistory();
    } catch (e) {
      await Storage.updateTaskHistory(recordId, { status: 'failed', error: e.message, retryCount: (record.retryCount || 0) + 1 });
      showR('historyResult', 'error', `❌ 重试失败: ${e.message}`, e.traceId);
      await refreshHistory();
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔁 重试'; }
  }

  async function retryAllFailed() {
    const r = await sendMessage({ action: 'getFailedTasks' });
    if (!r.success || !r.data?.length) return showR('historyResult', 'error', '没有失败的任务');

    const btn = $('#btnRetryAllFailed');
    btn.disabled = true;
    const failed = r.data;
    btn.textContent = `重试中 (0/${failed.length})...`;

    let ok = 0, fail = 0;
    for (let i = 0; i < failed.length; i++) {
      btn.textContent = `重试中 (${i + 1}/${failed.length})...`;
      const record = failed[i];
      try {
        const mapping = await sendMessage({ action: 'getEndpointMapping' });
        if (record.type === 'batch') {
          const res = await sendMessage({
            action: 'createTasksBatch', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
            endpointMapping: mapping.success ? mapping.data : undefined,
            tasksData: record.tasksData || record.taskData,
          });
          if (!res.success) throw new Error(res.error);
        } else {
          const res = await sendMessage({
            action: 'createTask', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
            endpointMapping: mapping.success ? mapping.data : undefined,
            taskData: record.taskData,
          });
          if (!res.success) throw new Error(res.error);
        }
        await Storage.updateTaskHistory(record.id, { status: 'success', retryCount: (record.retryCount || 0) + 1, error: null });
        ok++;
      } catch (e) {
        await Storage.updateTaskHistory(record.id, { status: 'failed', error: e.message, retryCount: (record.retryCount || 0) + 1 });
        fail++;
      }
    }
    btn.disabled = false; btn.textContent = '🔁 重试全部失败';
    showR('historyResult', 'success', `✅ 重试完成: ${ok} 成功, ${fail} 失败`);
    await refreshHistory();
  }

  async function copyTaskData(recordId) {
    const r = await sendMessage({ action: 'getTaskHistory' });
    if (!r.success) return;
    const record = r.data.find((h) => h.id === recordId);
    if (!record?.taskData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(record.taskData, null, 2));
      showR('historyResult', 'success', '📋 任务数据已复制到剪贴板');
    } catch (_) {
      showR('historyResult', 'error', '复制失败');
    }
  }

  // ---- Utility ----
  function extractPath(url) { try { return new URL(url).pathname; } catch (_) { return url; } }
  function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
  function showR(target, type, msg, traceId) {
    const el = $(`#${target}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `result ${type}`;
    if (type === 'error') {
      setDataTraceId(el, traceId);
    } else {
      setDataTraceId(el, '');
    }
    setTimeout(() => {
      el.className = 'result';
      el.removeAttribute('data-traceId');
    }, 8000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Panel.init());
