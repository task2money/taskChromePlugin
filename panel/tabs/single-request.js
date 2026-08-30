/**
 * Panel Tab 1：单请求创建（含搜索/过滤/详情填充/创建任务）（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js / workspace.js / branches.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.bindSingleTab = function () {
    if (!state.requestSort) state.requestSort = { key: 'timestamp', dir: 'desc' };
    if (state.requestTypeFilter == null) state.requestTypeFilter = '';
    P.$('#btnRefreshRequest').addEventListener('click', P.refreshRequestList);
    P.$('#btnClearRequestList')?.addEventListener('click', P.clearRequestList);
    // 搜索 & 过滤 — 实时过滤本地列表
    P.$('#requestSearch').addEventListener('input', P.applyRequestFilters);
    P.$('#requestMethodFilter').addEventListener('change', P.applyRequestFilters);
    P.$('#requestStatusFilter').addEventListener('change', P.applyRequestFilters);
    P.$('#requestTypeFilters')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-type]');
      if (!btn) return;
      state.requestTypeFilter = btn.getAttribute('data-type') || '';
      P.syncTypeChips();
      P.applyRequestFilters();
    });
    P.$$('.req-sort').forEach((btn) => {
      btn.addEventListener('click', () => {
        const Q = globalThis.RequestListQuery;
        state.requestSort = Q.nextSortState(state.requestSort, btn.dataset.sort);
        P.applyRequestFilters();
      });
    });
    P.$('#singleWorkspace').addEventListener('change', P.onSingleWorkspaceChange);
    P.$('#singleWorkBranch').addEventListener('change', () => P.handleBranchInputChange('singleWorkBranch', 'work', 'singleTaskTitle'));
    P.$('#singleMergeTarget').addEventListener('change', () => P.handleBranchInputChange('singleMergeTarget', 'merge'));
    P.$('#btnRefreshSingleBranches').addEventListener('click', () => {
      const wsId = P.$('#singleWorkspace').value;
      const checkedIds = P.getSelectedProjectIds('singleProjects');
      P.fetchSingleBranchLists(wsId, checkedIds);
    });
    P.$('#btnCreateSingle').addEventListener('click', P.createSingleTask);
    P.$('#singleFeatureParamsSource')?.addEventListener('change', P.onFeatureParamsSourceChange);
    P.$('#singleAutoRun')?.addEventListener('change', () => {
      const wsId = P.$('#singleWorkspace').value;
      P.refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
      P.syncContainerQueuedAutoRun('singleProjects');
    });
    P.$('#singleContainerImage')?.addEventListener('change', () => {
      P.onContainerImageChange('singleProjects');
    });
    P.initSingleDueDateDefault();
    // 项目勾选变化时，动态获取分支列表
    P.$('#singleProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-radio')) {
        const wsId = P.$('#singleWorkspace').value;
        const checkedIds = P.getSelectedProjectIds('singleProjects');
        P.syncContainerAutoRun('singleProjects');
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

  P.resetSingleCreateForm = function () {
    PanelCreateSuccess.resetSingleCreateFields(document, {
      emptyHint: CreateTaskPayload.REPO_BASE_EMPTY_HINT,
      defaultDueDate: CreateTaskPayload.getDefaultTaskDeadline(),
      defaultPriority: '1',
    });
    state.selectedRequest = null;
    P.applyRequestFilters();
    P.syncContainerAutoRun('singleProjects');
    P.onFeatureParamsSourceChange();
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

  P.syncTypeChips = function () {
    const selected = state.requestTypeFilter || '';
    P.$$('#requestTypeFilters .type-chip').forEach((btn) => {
      const on = (btn.getAttribute('data-type') || '') === selected;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  };

  P.syncSortHeaders = function () {
    const sort = state.requestSort || { key: 'timestamp', dir: 'desc' };
    P.$$('.req-sort').forEach((btn) => {
      if (btn.dataset.sort === sort.key) {
        btn.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      } else {
        btn.removeAttribute('aria-sort');
      }
    });
  };

  /**
   * 前端实时过滤+排序 — 搜索 / 方法 / 状态 / 类型 + 列头
   */
  P.applyRequestFilters = function () {
    state.requestListBootstrapped = true;
    const Q = (typeof window !== 'undefined' && window.RequestListQuery)
      || (typeof globalThis !== 'undefined' && globalThis.RequestListQuery);
    if (!Q || typeof Q.queryRequestList !== 'function') {
      throw new Error('RequestListQuery.queryRequestList is required');
    }
    const sort = state.requestSort || { key: 'timestamp', dir: 'desc' };
    const filtered = Q.queryRequestList(state.recentRequests, {
      search: P.$('#requestSearch')?.value || '',
      method: P.$('#requestMethodFilter')?.value || '',
      status: P.$('#requestStatusFilter')?.value || '',
      type: state.requestTypeFilter || '',
      sortKey: sort.key,
      sortDir: sort.dir,
    });
    P.syncTypeChips();
    P.syncSortHeaders();
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
      const when = req.timestamp ? new Date(req.timestamp).toLocaleTimeString() : '';
      const method = P.escHtml(req.method || '');
      html += `<div class="request-item${sel}" data-id="${P.escHtml(req.id)}">
        <span class="req-method ${method}">${method}</span>
        <span class="req-status ${sc}">${P.escHtml(statusLabel)}</span>
        <span class="req-url" title="${P.escHtml(req.url)}">${P.escHtml(urlShort)}</span>
        <span class="req-time">${P.escHtml(String(req.time || '?'))}ms</span>
        <span class="req-when">${P.escHtml(when)}</span>
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

    P.$('#singleTaskDesc').value = formatRequestAsTaskDescription(req, {
      statusLabel: P.formatRequestStatusLabel(req),
      canceled: P.isRequestCanceled(req),
    });
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
    if (!checkedIds.length) return P.showR('singleResult', 'error', '请选择一个项目');
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
      queued_auto_run: Boolean(P.$('#singleQueuedAutoRun')?.checked),
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
      const Success = PanelCreateSuccess;
      Success.runAfterSuccess({
        reset: () => P.resetSingleCreateForm(),
        showSuccess: (msg) => P.showR('singleResult', 'success', msg),
        message: Success.formatCreateSuccessMessage(Success.extractCreatedTaskId(r.data)),
      });
    } catch (e) {
      PanelCreateSuccess.runAfterFailure({
        showError: (msg, traceId) => P.showR('singleResult', 'error', msg, traceId),
        message: PanelCreateSuccess.formatCreateFailureMessage(e.message),
        traceId: e.traceId,
      });
    } finally { btn.disabled = false; btn.textContent = '✅ 创建任务'; }
  };
})();
