/**
 * Panel Tab 2：批量错误捕获 & 创建（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js / workspace.js / branches.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.bindBatchTab = function () {
    P.$('#captureToggle').addEventListener('change', P.onCaptureToggle);
    P.$('#batchWorkspace').addEventListener('change', P.onBatchWsChange);
    P.$('#batchWorkBranch').addEventListener('change', () => P.handleBranchInputChange('batchWorkBranch', 'work'));
    P.$('#batchMergeTarget').addEventListener('change', () => P.handleBranchInputChange('batchMergeTarget', 'merge'));
    P.$('#btnRefreshBatchBranches').addEventListener('click', () => {
      const wsId = P.$('#batchWorkspace').value;
      const checkedIds = P.getSelectedProjectIds('batchProjects');
      P.fetchBatchBranchLists(wsId, checkedIds);
    });
    P.$('#btnRefreshErrors').addEventListener('click', P.refreshCapturedCount);
    P.$('#batchFeatureParamsSource')?.addEventListener('change', P.onBatchFeatureParamsSourceChange);
    // 项目勾选变化时，动态获取分支列表 + 逐仓基准分支
    P.$('#batchProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-check') || e.target.classList.contains('select-all')) {
        const wsId = P.$('#batchWorkspace').value;
        const checkedIds = P.getSelectedProjectIds('batchProjects');
        P.fetchBatchBranchLists(wsId, checkedIds);
        P.refreshRepoBaseEditors('batchRepoBases', 'batchProjects', wsId);
      }
    });
    P.$('#btnClearErrors').addEventListener('click', P.clearCapturedErrors);
    P.$('#btnCreateBatch').addEventListener('click', P.createBatchTasks);
    P.initDueDateDefault('batchDueDate');
    P.loadCaptureConfig();
    P.loadWorkspaces('batchWorkspace');
    P.refreshCapturedCount();
  };

  P.loadCaptureConfig = async function () {
    const cfg = await Storage.getCaptureConfig();
    P.$('#captureToggle').checked = cfg.enabled;
    P.updateCaptureStatus(cfg.enabled);
    if (cfg.statusCodes) {
      P.$('#statusCodeFilters').querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = cfg.statusCodes.includes(cb.value);
      });
    }
  };

  P.onCaptureToggle = async function () {
    const en = P.$('#captureToggle').checked;
    const codes = Array.from(P.$('#statusCodeFilters').querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
    try {
      await P.sendMessage({ action: 'setCaptureEnabled', enabled: en, statusCodes: codes });
    } catch (_) { /* ignore */ }
    P.updateCaptureStatus(en);
  };

  P.updateCaptureStatus = function (en) { P.$('#captureStatus').textContent = en ? '🔴 自动捕获中...' : '⏸️ 捕获已停止'; };

  P.refreshCapturedCount = async function () {
    try {
      const r = await P.sendMessage({ action: 'getCapturedErrors' });
      const all = r?.success ? (r.data || []) : [];
      // 示数仅计 5xx；总捕获条数另注（可含 2xx/4xx/Canceled）
      const n5xx = CaptureStatus.filterBadgeCountableRequests(all).length;
      const nAll = all.length;
      const el = P.$('#capturedCount');
      if (el) {
        el.style.display = 'inline';
        el.innerHTML = ` | 5xx 示数: <strong>${n5xx}</strong>${nAll !== n5xx ? `（总捕获 ${nAll}）` : ''} 条`;
      }
    } catch (_) { /* ignore */ }
  };

  P.clearCapturedErrors = async function () {
    try {
      await P.sendMessage({ action: 'clearCapturedErrors' });
    } catch (_) { /* ignore */ }
    await P.refreshCapturedCount();
    P.showR('batchResult', 'success', '✅ 已清空');
  };

  P.onBatchWsChange = async function () {
    const id = P.$('#batchWorkspace').value;
    await Storage.saveLastWorkspace(id);
    if (!id) {
      P.$('#batchProjects').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      P.$('#batchProgressColumn').innerHTML = '<option value="">请先选择工作空间</option>';
      if (P.$('#batchDeliverable')) P.$('#batchDeliverable').innerHTML = '<option value="">请先选择工作空间</option>';
      if (P.$('#batchRepoBases')) {
        P.$('#batchRepoBases').innerHTML = '<p class="placeholder">勾选项目后按仓库填写基准分支</p>';
      }
      P.fetchAndPopulateBranches('batchWorkBranchList', '', [], 'work');
      P.fetchAndPopulateBranches('batchMergeTargetList', '', [], 'merge');
      return;
    }
    const ws = state.workspaces.find(w => (w.id || w._id) === id);
    const companyId = ws?.company_id || ws?.companyId;
    await P.loadProjects(id, 'batchProjects', companyId);
    if (companyId) {
      await P.loadProgressColumns(String(companyId), id, 'batchProgressColumn');
      await P.loadDeliverableTypesInto('batchDeliverable', String(companyId), id);
      await P.loadInstalledImagesInto('batchContainerImage', String(companyId));
    }
    await P.loadPersonalFeatureParamsInto('batchPersonalConfig');
    P.initDueDateDefault('batchDueDate');
    // 恢复选中后加载分支
    const checkedIds = P.getSelectedProjectIds('batchProjects');
    if (checkedIds.length) {
      P.fetchBatchBranchLists(id, checkedIds);
    } else {
      P.fetchAndPopulateBranches('batchWorkBranchList', id, [], 'work');
      P.fetchAndPopulateBranches('batchMergeTargetList', id, [], 'merge');
    }
    P.refreshRepoBaseEditors('batchRepoBases', 'batchProjects', id);
  };

  P.onBatchFeatureParamsSourceChange = function () {
    const source = P.$('#batchFeatureParamsSource')?.value || '';
    const wrap = P.$('#batchPersonalConfigWrap');
    if (wrap) wrap.hidden = source !== 'personal';
  };

  P.createBatchTasks = async function () {
    const wsId = P.$('#batchWorkspace').value;
    const checkedIds = P.getSelectedProjectIds('batchProjects');
    const progressColumnId = P.$('#batchProgressColumn').value;
    const workBranch = (P.$('#batchWorkBranch').value || '').trim();
    const mergeTarget = (P.$('#batchMergeTarget').value || '').trim();
    const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot(P.$('#batchRepoBases'));
    const deliverableObjId = (P.$('#batchDeliverable')?.value || '').trim();
    const containerImageId = (P.$('#batchContainerImage')?.value || '').trim();
    const featureParamsSource = (P.$('#batchFeatureParamsSource')?.value || '').trim();
    const personalConfigId = (P.$('#batchPersonalConfig')?.value || '').trim();
    const dueDate = (P.$('#batchDueDate')?.value || '').trim();
    const autoRun = Boolean(P.$('#batchAutoRun')?.checked);

    if (!wsId) return P.showR('batchResult', 'error', '请选择工作空间');
    if (!checkedIds.length) return P.showR('batchResult', 'error', '请勾选至少一个项目');
    if (!(await P.ensureApiReady())) return P.showR('batchResult', 'error', '请先登录或会话已过期');

    const featureGate = CreateTaskPayload.validateCreateTaskForm({
      title: 'batch',
      workspaceId: wsId,
      owner: 'pending',
      projectIds: checkedIds,
      feature_params_source: featureParamsSource,
      personal_feature_params_config_id: personalConfigId,
    });
    if (featureGate && /环境变量参数/.test(featureGate)) {
      return P.showR('batchResult', 'error', featureGate);
    }

    const cached = state.projectsCache[wsId] || [];
    const projects = CreateTaskPayload.buildProjectsFromSelection({
      projectIds: checkedIds,
      projectsList: cached,
      workBranch,
      repoBaseBranches,
    });

    const r = await P.sendMessage({ action: 'getCapturedErrors' });
    if (!r.success || !r.data?.length) return P.showR('batchResult', 'error', '没有捕获到错误请求');

    // 批量建任务仅针对 5xx（与插件角标示数一致）
    const errors = CaptureStatus.filterBadgeCountableRequests(r.data);
    if (!errors.length) {
      return P.showR('batchResult', 'error', '没有可建任务的 5xx 请求（示数仅计 5xx）');
    }
    const btn = P.$('#btnCreateBatch');
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
          title: `[${e.method}] ${P.extractPath(e.url)} → ${statusLabel}`,
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
          owner: P.$('#singleOwner')?.value || undefined,
        });
      });
      const mapping = await P.sendMessage({ action: 'getEndpointMapping' });
      const b = await P.sendMessage({
        action: 'createTasksBatch', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
        endpointMapping: mapping.success ? mapping.data : undefined,
        tasksData: tasks,
      });
      if (!b.success) {
        const err = new Error(b.error);
        const tid = extractTraceId(b);
        if (tid) err.traceId = tid;
        throw err;
      }
      P.showR('batchResult', 'success', `✅ 批量创建完成! 共 ${tasks.length} 个任务`);
      await P.sendMessage({ action: 'clearCapturedErrors' });
      await P.refreshCapturedCount();
    } catch (e) {
      P.showR('batchResult', 'error', `❌ 失败: ${e.message}`, e.traceId);
    } finally { btn.disabled = false; btn.textContent = '📦 批量创建任务'; }
  };
})();
