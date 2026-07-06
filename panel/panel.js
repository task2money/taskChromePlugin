/**
 * DevTools Panel 主逻辑
 * Tab 1: 单请求创建任务 (含搜索/过滤)
 * Tab 2: 批量错误捕获 & 创建
 * Tab 3: 错误列表查看
 * Tab 4: 历史记录 & 重试
 */

const Panel = (() => {
  // ---- State ----
  let apiConfig = { baseUrl: 'http://183.250.1.132:18081', token: '' };
  let isLoggedIn = false;
  let selectedRequest = null;
  let recentRequests = [];
  let workspaces = [];
  let projectsCache = {};
  let membersCache = {};   // { companyId: [{id, user_id, member_name, ...}] }
  let progressColumnsCache = {};
  let currentUserId = '';  // set after login
  let currentMemberId = '';  // from login response current_company.member_id

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

  // ---- Init ----
  async function init() {
    await refreshAuthState();
    await loadSavedOwner();
    bindTabs();
    bindAuthListener();
    bindSingleTab();
    bindBatchTab();
    bindErrorListTab();
    bindHistoryTab();
    initBranchDatalistPresets();
    // 监听来自 devtools.js 的 postMessage（直接接收请求，不依赖 service worker）
    window.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.action === 'initRequests') {
        recentRequests = event.data.requests || [];
        recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        applyRequestFilters();
      } else if (event.data.action === 'newRequest') {
        recentRequests.unshift(event.data.request);
        if (recentRequests.length > 500) recentRequests.pop();
        applyRequestFilters();
      } else if (event.data.action === 'requestUpdated') {
        const updated = event.data.request;
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
    });
    // 立即加载工作空间（不等待用户点击请求）
    loadWorkspaces('singleWorkspace');
    await checkConnection();
    // 数据由 postMessage 推送；若 1.5s 内未收到则从 SW 兜底
    setTimeout(async () => {
      if (recentRequests.length === 0) {
        try {
          const res = await sendMessage({ action: 'getRecentRequests', filter: {}, limit: 200 });
          if (res.success && res.data?.length > 0) {
            recentRequests = res.data;
            recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            applyRequestFilters();
          }
        } catch (_) { /* ignore */ }
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
      const data = await API.getMembers(companyId);
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
      const data = await API.fetchProgressColumns(companyId, wsId);
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

  async function refreshAuthState() {
    apiConfig = await Storage.getApiConfig();
    const cred = await Storage.getCredentials();
    if (cred.userId) currentUserId = String(cred.userId);
    if (cred.memberId) currentMemberId = String(cred.memberId);
    const expired = await Storage.isTokenExpired();
    isLoggedIn = !!(apiConfig.token && !expired);
    if (isLoggedIn) {
      const mapping = await Storage.getEndpointMapping();
      API.init(apiConfig.baseUrl, apiConfig.token, mapping);
    }
    updateStatusBadge(expired);
    return isLoggedIn;
  }

  async function ensureApiReady() {
    await refreshAuthState();
    return isLoggedIn;
  }

  function handleApiAuthFailure(err) {
    const msg = String(err?.message || err || '');
    if (!/\b401\b/.test(msg)) return false;
    isLoggedIn = false;
    updateStatusBadge(true);
    return true;
  }

  function bindAuthListener() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action !== 'authStateChanged') return;
      projectsCache = {};
      refreshAuthState().then(() => {
        loadWorkspaces('singleWorkspace');
        if ($('#batchWorkspace')?.value) {
          loadWorkspaces('batchWorkspace');
        }
      }).catch((e) => {
        console.warn('[taskChromePlugin] panel authStateChanged 刷新失败:', e.message);
      });
    });
  }

  function updateStatusBadge(expired = false) {
    const badge = $('#statusBadge');
    if (!apiConfig.token) {
      badge.textContent = '⚠️ 未登录';
      badge.className = 'badge badge-disconnected';
    } else if (expired || !isLoggedIn) {
      badge.textContent = '⏰ 会话过期';
      badge.className = 'badge badge-disconnected';
    } else {
      badge.textContent = '✅ 已连接';
      badge.className = 'badge badge-connected';
    }
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
        const resp = await API.getBranches(String(companyId), pid, repoUrl);
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
    // 项目勾选变化时，动态获取分支列表
    $('#singleProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = $('#singleWorkspace').value;
        const checkedIds = getSelectedProjectIds('singleProjects');
        fetchSingleBranchLists(wsId, checkedIds);
      }
    });
  }

  async function refreshRequestList() {
    // 数据由 devtools.js 通过 postMessage 实时推送，这里只需重新过滤
    applyRequestFilters();
  }

  function setRequestLoading(loading) {
    const el = $('#selectedRequest');
    if (loading && recentRequests.length === 0) {
      el.innerHTML = '<p class="placeholder">⏳ 加载中...</p>';
      el.classList.add('empty');
    }
  }

  /**
   * 前端实时过滤 — 按搜索文本 + 方法 + 状态码
   */
  function applyRequestFilters() {
    const search = ($('#requestSearch').value || '').toLowerCase();
    const method = $('#requestMethodFilter').value;
    const status = $('#requestStatusFilter').value;

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
    $('#requestCount').textContent = `共 ${filtered.length} 条`;
  }

  function renderRequestList(requests) {
    const container = $('#selectedRequest');
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
  async function loadWorkspaces(selectId) {
    const sel = $(`#${selectId}`);
    if (!sel) return;
    if (!(await ensureApiReady())) {
      sel.innerHTML = `<option value="">-- ${apiConfig.token ? '会话过期，请重新登录' : '请先登录'} --</option>`;
      return;
    }
    sel.innerHTML = '<option value="">加载中...</option>';
    try {
      const data = await API.getWorkspaces();
      workspaces = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      renderWorkspaceOptions(selectId);
      // 自动选择 workspace：优先上次选择的，其次唯一 workspace
      const last = await Storage.getLastWorkspace();
      if (last && workspaces.some((w) => (w.id || w._id) === last)) {
        sel.value = last;
      } else if (workspaces.length === 1) {
        sel.value = workspaces[0].id || workspaces[0]._id;
      }
      // 无论如何都触发 change，确保项目/负责人/进度列加载
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
      fetchAndPopulateBranches('singleWorkBranchList', '', [], 'work');
      fetchAndPopulateBranches('singleMergeTargetList', '', [], 'merge');
      return;
    }
    await loadProjects(wsId, 'singleProjects');
    // Load members from the workspace's company
    const ws = workspaces.find(w => (w.id || w._id) === wsId);
    const companyId = ws?.company_id || ws?.companyId;
    if (companyId) {
      await loadMembers(companyId);
      await loadProgressColumns(String(companyId), wsId, 'singleProgressColumn');
    }
    // 恢复选中后加载分支
    const checkedIds = getSelectedProjectIds('singleProjects');
    if (checkedIds.length) {
      fetchSingleBranchLists(wsId, checkedIds);
    } else {
      fetchAndPopulateBranches('singleWorkBranchList', wsId, [], 'work');
      fetchAndPopulateBranches('singleMergeTargetList', wsId, [], 'merge');
    }
  }

  async function loadProjects(wsId, containerId) {
    const c = $(`#${containerId}`);
    c.innerHTML = '<p class="placeholder">加载中...</p>';
    if (!(await ensureApiReady())) {
      c.innerHTML = '<p class="placeholder">请先登录</p>';
      return;
    }
    if (projectsCache[wsId]) { renderProjectCheckboxes(containerId, projectsCache[wsId]); return; }
    try {
      const data = await API.getProjects(wsId);
      const projs = Array.isArray(data) ? data : (data?.items || data?.data || []);
      projectsCache[wsId] = projs;
      renderProjectCheckboxes(containerId, projs);
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
    // 从缓存中获取完整项目信息，构建包含 base_branch 和 target_branch 的 projects 数组
    const cached = projectsCache[wsId] || [];
    const title = $('#singleTaskTitle').value.trim();
    const desc = $('#singleTaskDesc').value.trim();
    const priority = $('#singlePriority').value;
    const owner = $('#singleOwner').value.trim();
    const progressColumnId = $('#singleProgressColumn').value;
    // 分支策略输入
    const workBranch = ($('#singleWorkBranch').value || '').trim();
    const mergeTarget = ($('#singleMergeTarget').value || '').trim();

    if (!wsId) return showR('singleResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return showR('singleResult', 'error', '请勾选至少一个项目');
    if (!title) return showR('singleResult', 'error', '请输入任务标题');
    if (!owner) return showR('singleResult', 'error', '请填写 Owner (CompanyMember.id)，可在端点映射中配置默认值');
    if (!selectedRequest) return showR('singleResult', 'error', '请从请求列表中选择一个请求');
    if (!(await ensureApiReady())) return showR('singleResult', 'error', '请先登录或会话已过期');

    // 将项目展开为 API 所需的 repo 级条目（含 repo_index）
    const projects = [];
    for (const pid of checkedIds) {
      const proj = cached.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      if (repos.length === 0) {
        projects.push({
          project_id: pid,
          repo_index: 0,
          base_branch: proj?.base_branch || proj?.default_branch || 'main',
          target_branch: workBranch,
        });
      } else {
        for (let i = 0; i < repos.length; i++) {
          projects.push({
            project_id: pid,
            repo_index: i,
            base_branch: proj?.base_branch || proj?.default_branch || 'main',
            target_branch: workBranch,
          });
        }
      }
    }

    const btn = $('#btnCreateSingle');
    btn.disabled = true; btn.textContent = '创建中...';
    try {
      await Storage.saveLastProjectIds(checkedIds);
      // 描述由 fillRequestDetail 自动填充，已包含完整的请求/响应头体
      const mapping = await sendMessage({ action: 'getEndpointMapping' });
      const taskData = { title, description: desc, priority, workspaceId: wsId, projects, owner, source: 'chrome-devtools' };
      if (progressColumnId) taskData.progress_column_id = progressColumnId;
      // 若填写了分支名，设置 branch_strategy
      if (workBranch || mergeTarget) {
        taskData.branch_strategy = {
          work_branch_name: workBranch,
          merge_target_branch_name: mergeTarget,
          target_branch_name: workBranch,
        };
      }
      const r = await sendMessage({
        action: 'createTask', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        taskData,
      });
      if (!r.success) throw new Error(r.error);
      showR('singleResult', 'success', `✅ 任务创建成功! ID: ${r.data?.id || r.data?._id || '(已创建)'}`);
    } catch (e) {
      showR('singleResult', 'error', `❌ 创建失败: ${e.message}`);
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
    // 项目勾选变化时，动态获取分支列表
    $('#batchProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = $('#batchWorkspace').value;
        const checkedIds = getSelectedProjectIds('batchProjects');
        fetchBatchBranchLists(wsId, checkedIds);
      }
    });
    $('#btnClearErrors').addEventListener('click', clearCapturedErrors);
    $('#btnCreateBatch').addEventListener('click', createBatchTasks);
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
      const n = r?.success ? (r.data?.length || 0) : 0;
      const el = $('#capturedCount');
      if (el) { el.style.display = 'inline'; el.innerHTML = ` | 已捕获错误: <strong>${n}</strong> 条`; }
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
      fetchAndPopulateBranches('batchWorkBranchList', '', [], 'work');
      fetchAndPopulateBranches('batchMergeTargetList', '', [], 'merge');
      return;
    }
    await loadProjects(id, 'batchProjects');
    const ws = workspaces.find(w => (w.id || w._id) === id);
    const companyId = ws?.company_id || ws?.companyId;
    if (companyId) {
      await loadProgressColumns(String(companyId), id, 'batchProgressColumn');
    }
    // 恢复选中后加载分支
    const checkedIds = getSelectedProjectIds('batchProjects');
    if (checkedIds.length) {
      fetchBatchBranchLists(id, checkedIds);
    } else {
      fetchAndPopulateBranches('batchWorkBranchList', id, [], 'work');
      fetchAndPopulateBranches('batchMergeTargetList', id, [], 'merge');
    }
  }

  async function createBatchTasks() {
    const wsId = $('#batchWorkspace').value;
    const checkedIds = getSelectedProjectIds('batchProjects');
    const progressColumnId = $('#batchProgressColumn').value;
    const workBranch = ($('#batchWorkBranch').value || '').trim();
    const mergeTarget = ($('#batchMergeTarget').value || '').trim();
    if (!wsId) return showR('batchResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return showR('batchResult', 'error', '请勾选至少一个项目');
    if (!(await ensureApiReady())) return showR('batchResult', 'error', '请先登录或会话已过期');

    // 从缓存中获取完整项目信息，构建包含 base_branch 和 target_branch 的 projects 数组
    const cached = projectsCache[wsId] || [];
    const projects = [];
    for (const pid of checkedIds) {
      const proj = cached.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      if (repos.length === 0) {
        projects.push({
          project_id: pid,
          repo_index: 0,
          base_branch: proj?.base_branch || proj?.default_branch || 'main',
          target_branch: workBranch,
        });
      } else {
        for (let i = 0; i < repos.length; i++) {
          projects.push({
            project_id: pid,
            repo_index: i,
            base_branch: proj?.base_branch || proj?.default_branch || 'main',
            target_branch: workBranch,
          });
        }
      }
    }

    const r = await sendMessage({ action: 'getCapturedErrors' });
    if (!r.success || !r.data?.length) return showR('batchResult', 'error', '没有捕获到错误请求');

    const errors = r.data;
    const btn = $('#btnCreateBatch');
    btn.disabled = true; btn.textContent = `创建中 (${errors.length})...`;
    try {
      await Storage.saveLastProjectIds(checkedIds);
      const tasks = errors.map((e) => {
        const statusLabel = e.canceled || e.statusCode === 0 ? 'Canceled' : String(e.statusCode);
        let desc = `**自动捕获**\n- URL: ${e.url}\n- 方法: ${e.method}\n- 状态码: ${statusLabel} ${e.statusLine || ''}\n- 时间: ${new Date(e.capturedAt || e.timeStamp).toISOString()}`;
        if (e.error) desc += `\n- 错误: ${e.error}`;
        // 响应头
        if (e.responseHeaders && Object.keys(e.responseHeaders).length) {
          desc += `\n\n**响应头**:\n\`\`\`\n${Object.entries(e.responseHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
        }
        // 请求头
        if (e.requestHeaders && Object.keys(e.requestHeaders).length) {
          desc += `\n\n**请求头**:\n\`\`\`\n${Object.entries(e.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\``;
        }
        const task = {
          title: `[${e.method}] ${extractPath(e.url)} → ${statusLabel}`,
          description: desc,
          priority: e.canceled || e.statusCode === 0 ? 'medium' : (e.statusCode >= 500 ? 'high' : 'medium'),
          workspaceId: wsId, projects,
          source: 'chrome-auto-capture', sourceUrl: e.url, sourceStatusCode: e.statusCode, sourceMethod: e.method, capturedAt: e.capturedAt || e.timeStamp,
        };
        if (progressColumnId) task.progress_column_id = progressColumnId;
        if (workBranch || mergeTarget) {
          task.branch_strategy = {
            work_branch_name: workBranch,
            merge_target_branch_name: mergeTarget,
            target_branch_name: workBranch,
          };
        }
        return task;
      });
      const mapping = await sendMessage({ action: 'getEndpointMapping' });
      const b = await sendMessage({
        action: 'createTasksBatch', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        tasksData: tasks,
      });
      if (!b.success) throw new Error(b.error);
      showR('batchResult', 'success', `✅ 批量创建完成! 共 ${tasks.length} 个任务`);
      await sendMessage({ action: 'clearCapturedErrors' });
      await refreshCapturedCount();
    } catch (e) {
      showR('batchResult', 'error', `❌ 失败: ${e.message}`);
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
      if (!r.success || !r.data?.length) { c.innerHTML = '<p class="placeholder">暂无捕获的错误请求</p>'; return; }
      let h = '';
      for (const e of [...r.data].reverse()) {
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
        if (!res.success) throw new Error(res.error);
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      } else {
        const res = await sendMessage({
          action: 'createTask', baseUrl: apiConfig.baseUrl, token: apiConfig.token,
          endpointMapping: mapping.success ? mapping.data : undefined,
          taskData: record.taskData,
        });
        if (!res.success) throw new Error(res.error);
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      }
      showR('historyResult', 'success', '✅ 重试成功!');
      await refreshHistory();
    } catch (e) {
      await Storage.updateTaskHistory(recordId, { status: 'failed', error: e.message, retryCount: (record.retryCount || 0) + 1 });
      showR('historyResult', 'error', `❌ 重试失败: ${e.message}`);
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
  function showR(target, type, msg) {
    const el = $(`#${target}`);
    if (!el) return;
    el.textContent = msg; el.className = `result ${type}`;
    setTimeout(() => { el.className = 'result'; }, 8000);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Panel.init());
