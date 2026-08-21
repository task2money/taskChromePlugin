/**
 * Panel Tab 1：单请求创建（含搜索/过滤/详情填充/创建任务）（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js / workspace.js / branches.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.bindSingleTab = function () {
    P.$('#btnRefreshRequest').addEventListener('click', P.refreshRequestList);
    P.$('#btnClearRequestList')?.addEventListener('click', P.clearRequestList);
    // 搜索 & 过滤 — 实时过滤本地列表
    P.$('#requestSearch').addEventListener('input', P.applyRequestFilters);
    P.$('#requestMethodFilter').addEventListener('change', P.applyRequestFilters);
    P.$('#requestStatusFilter').addEventListener('change', P.applyRequestFilters);
    P.$('#singleWorkspace').addEventListener('change', P.onSingleWorkspaceChange);
    P.$('#singleWorkBranch').addEventListener('change', () => P.handleBranchInputChange('singleWorkBranch', 'work', 'singleTaskTitle'));
    P.$('#singleMergeTarget').addEventListener('change', () => P.handleBranchInputChange('singleMergeTarget', 'merge'));
    P.$('#btnRefreshSingleBranches').addEventListener('click', () => {
      const wsId = P.$('#singleWorkspace').value;
      const checkedIds = P.getSelectedProjectIds('singleProjects');
      P.fetchSingleBranchLists(wsId, checkedIds);
    });
    P.$('#btnCreateSingle').addEventListener('click', P.createSingleTask);
    P.$('#btnPickElement')?.addEventListener('click', P.startPageElementPick);
    P.$('#singleFeatureParamsSource')?.addEventListener('change', P.onFeatureParamsSourceChange);
    P.$('#singleAutoRun')?.addEventListener('change', () => {
      const wsId = P.$('#singleWorkspace').value;
      P.refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
    });
    P.initSingleDueDateDefault();
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.action === 'elementPickResult' && msg.block) {
        P.appendElementPickBlock(msg.block);
      }
    });
    // 项目勾选变化时，动态获取分支列表
    P.$('#singleProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = P.$('#singleWorkspace').value;
        const checkedIds = P.getSelectedProjectIds('singleProjects');
        P.fetchSingleBranchLists(wsId, checkedIds);
        P.refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
      }
    });
  };

  P.onFeatureParamsSourceChange = function () {
    const source = P.$('#singleFeatureParamsSource')?.value || '';
    const wrap = P.$('#singlePersonalConfigWrap');
    if (wrap) wrap.hidden = source !== 'personal';
  };

  P.appendElementPickBlock = function (block) {
    const ta = P.$('#singleTaskDesc');
    if (!ta || !block) return;
    const base = (ta.value || '').trimEnd();
    ta.value = base ? `${base}\n\n${block}` : block;
    P.showR('singleResult', 'success', '✅ 已将页面元素调整加入任务描述');
    console.log('[taskChromePlugin] panel received elementPickResult, len=', block.length);
  };

  P.startPageElementPick = async function () {
    const tabId = chrome.devtools?.inspectedWindow?.tabId;
    if (!tabId) {
      P.showR('singleResult', 'error', '无法获取当前检查页 tabId');
      return;
    }
    const btn = P.$('#btnPickElement');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '选择中…';
    }
    try {
      const r = await P.sendMessage({
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
      P.showR('singleResult', 'success', '请在页面中点击目标元素（Esc 取消）');
    } catch (e) {
      P.showR('singleResult', 'error', `无法启动指针选择: ${e.message}`, e.traceId);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🖱️ 指针选择';
      }
    }
  };

  P.refreshRequestList = async function () {
    // 主动从 SW 拉取最新请求：devtools.js 每次 pushRequest 都会同步到 SW。
    // 仅做本地过滤会导致 postMessage 丢失后列表永久停滞（无法刷新）。
    try {
      const res = await P.sendMessage({ action: 'getRecentRequests', filter: {}, limit: 200 });
      if (res?.success && Array.isArray(res.data)) {
        state.recentRequests = res.data;
      }
    } catch (_) {
      // SW 不可达时保留本地数据，仍重新渲染
    }
    P.applyRequestFilters();
  };

  /**
   * 清空请求列表：本地 + SW 内存缓存。
   * DevTools 页同步监听 clearRecentRequests，清空其缓冲并推送空 initRequests。
   * 不清除标题/描述等表单字段（用户可能已手改）。
   */
  P.clearRequestList = async function () {
    state.selectedRequest = null;
    state.recentRequests = [];
    try {
      await P.sendMessage({ action: 'clearRecentRequests' });
    } catch (_) {
      // SW 不可达时仍清空本地 UI
    }
    P.applyRequestFilters();
    P.showR('singleResult', 'success', '✅ 已清空请求列表');
  };

  P.setRequestLoading = function (loading) {
    const el = P.$('#selectedRequest');
    if (!el) return;
    if (loading && state.recentRequests.length === 0 && !state.requestListBootstrapped) {
      el.innerHTML = '<p class="placeholder">⏳ 加载中...</p>';
      el.classList.add('empty');
      return;
    }
    // loading=false 或已有数据：必须刷新，清除 HTML 初始「正在加载请求列表...」
    P.applyRequestFilters();
  };

  /**
   * 前端实时过滤 — 按搜索文本 + 方法 + 状态码
   */
  P.applyRequestFilters = function () {
    state.requestListBootstrapped = true;
    const search = (P.$('#requestSearch')?.value || '').toLowerCase();
    const method = P.$('#requestMethodFilter')?.value || '';
    const status = P.$('#requestStatusFilter')?.value || '';

    let filtered = state.recentRequests.filter((r) => {
      // 搜索：匹配 URL 或方法或状态码
      if (search) {
        const url = (r.url || '').toLowerCase();
        const m = (r.method || '').toLowerCase();
        const sc = String(r.statusCode || '');
        const canceledLabel = P.isRequestCanceled(r) ? 'canceled' : '';
        if (!url.includes(search) && !m.includes(search) && !sc.includes(search) && !canceledLabel.includes(search)) {
          return false;
        }
      }
      // 方法过滤
      if (method && r.method !== method) return false;
      // 状态码过滤
      if (status === 'canceled' && !P.isRequestCanceled(r)) return false;
      if (status === '2xx' && !(r.statusCode >= 200 && r.statusCode < 300)) return false;
      if (status === '3xx' && !(r.statusCode >= 300 && r.statusCode < 400)) return false;
      if (status === '4xx' && !(r.statusCode >= 400 && r.statusCode < 500)) return false;
      if (status === '5xx' && !(r.statusCode >= 500 && r.statusCode < 600)) return false;
      return true;
    });

    // 按时间倒序
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    P.renderRequestList(filtered.slice(0, 100));
    const countEl = P.$('#requestCount');
    if (countEl) countEl.textContent = `共 ${filtered.length} 条`;
  };

  P.renderRequestList = function (requests) {
    const container = P.$('#selectedRequest');
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
      const sc = P.getRequestStatusClass(req);
      const statusLabel = P.formatRequestStatusLabel(req);
      const sel = state.selectedRequest?.id === req.id ? ' selected' : '';
      const urlShort = (req.url || '').length > 100 ? req.url.slice(0, 100) + '...' : req.url;
      html += `<div class="request-item${sel}" data-id="${req.id}">
        <span class="req-method ${req.method}">${req.method}</span>
        <span class="req-status ${sc}">${statusLabel}</span>
        <span class="req-url" title="${P.escHtml(req.url)}">${P.escHtml(urlShort)}</span>
        <span class="req-time">${req.time || '?'}ms</span>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.request-item').forEach((el) => {
      el.addEventListener('click', () => {
        const r = state.recentRequests.find((x) => x.id === el.dataset.id);
        if (r) P.selectRequest(r);
      });
    });
  };

  P.selectRequest = function (req) {
    state.selectedRequest = req;
    P.$$('.request-item').forEach((x) => x.classList.remove('selected'));
    const tgt = document.querySelector(`.request-item[data-id="${req.id}"]`);
    if (tgt) tgt.classList.add('selected');
    P.fillRequestDetail(req);
  };

  P.fillRequestDetail = function (req) {
    // 自动填充标题
    let p = ''; try { p = new URL(req.url).pathname; } catch (_) { p = req.url; }
    P.$('#singleTaskTitle').value = `[${req.method}] ${p} → ${P.formatRequestStatusLabel(req)}`;

    // 自动填充描述（每次切换都更新 — 含完整的请求/响应头体）
    let d = `**请求**: ${req.method} ${req.url}\n**状态码**: ${P.formatRequestStatusLabel(req)} ${req.statusText || ''}\n**耗时**: ${req.time || '?'}ms`;
    if (P.isRequestCanceled(req) && req.error) {
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
    P.$('#singleTaskDesc').value = d;
    if (!P.$('#singleWorkspace').value) {
      P.loadWorkspaces('singleWorkspace');
    }
    // 自动填充工作分支名（若未手动填写）
    if (!P.$('#singleWorkBranch').value) {
      const pathname = p.replace(/\//g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const status = req.statusCode;
      const prefix = status >= 500 ? 'fix' : (status >= 400 ? 'fix' : 'feat');
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      P.$('#singleWorkBranch').value = `${prefix}/${today}_devtools_aidev\${taskId}_${pathname}`;
    }
    // 自动填充合并目标分支（若未手动填写）
    if (!P.$('#singleMergeTarget').value) {
      P.$('#singleMergeTarget').value = 'main';
    }
  };

  P.createSingleTask = async function () {
    const wsId = P.$('#singleWorkspace').value;
    const checkedIds = P.getSelectedProjectIds('singleProjects');
    const cached = state.projectsCache[wsId] || [];
    const title = P.$('#singleTaskTitle').value.trim();
    const desc = P.$('#singleTaskDesc').value.trim();
    const priority = P.$('#singlePriority').value;
    const owner = P.$('#singleOwner').value.trim();
    const progressColumnId = P.$('#singleProgressColumn').value;
    const workBranch = (P.$('#singleWorkBranch').value || '').trim();
    const mergeTarget = (P.$('#singleMergeTarget').value || '').trim();
    const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot(P.$('#singleRepoBases'));
    const deliverableObjId = (P.$('#singleDeliverable').value || '').trim();
    const containerImageId = (P.$('#singleContainerImage').value || '').trim();
    const featureParamsSource = (P.$('#singleFeatureParamsSource').value || '').trim();
    const personalConfigId = (P.$('#singlePersonalConfig').value || '').trim();
    const dueDate = (P.$('#singleDueDate').value || '').trim();
    const autoRun = Boolean(P.$('#singleAutoRun')?.checked);
    const assignees = P.getSelectedAssigneeIds();
    const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
    const repoIdentities = GitId
      ? GitId.readRepoIdentitiesFromRoot(P.$('#singleGitIdentities'))
      : [];

    if (!wsId) return P.showR('singleResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return P.showR('singleResult', 'error', '请勾选至少一个项目');
    if (!title) return P.showR('singleResult', 'error', '请输入任务标题');
    if (!owner) return P.showR('singleResult', 'error', '请填写 Owner (CompanyMember.id)，可在端点映射中配置默认值');
    if (!state.selectedRequest) return P.showR('singleResult', 'error', '请从请求列表中选择一个请求');
    if (!(await P.ensureApiReady())) return P.showR('singleResult', 'error', '请先登录或会话已过期');

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
      repo_identities: repoIdentities,
    };
    const blocked = CreateTaskPayload.validateCreateTaskForm(form);
    if (blocked) return P.showR('singleResult', 'error', blocked);

    const btn = P.$('#btnCreateSingle');
    btn.disabled = true; btn.textContent = '创建中...';
    try {
      await Storage.saveLastProjectIds(checkedIds);
      const mapping = await P.sendMessage({ action: 'getEndpointMapping' });
      const taskData = CreateTaskPayload.buildCreateTaskPayload(form);
      const r = await P.sendMessage({
        action: 'createTask', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        taskData,
      });
      if (!r.success) {
        const err = new Error(r.error);
        const tid = extractTraceId(r);
        if (tid) err.traceId = tid;
        throw err;
      }
      P.showR('singleResult', 'success', `✅ 任务创建成功! ID: ${r.data?.id || r.data?._id || '(已创建)'}`);
    } catch (e) {
      P.showR('singleResult', 'error', `❌ 创建失败: ${e.message}`, e.traceId);
    } finally { btn.disabled = false; btn.textContent = '✅ 创建任务'; }
  };
})();
