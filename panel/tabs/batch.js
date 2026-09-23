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
    P.$('#batchAutoRun')?.addEventListener('change', () => {
      const wsId = P.$('#batchWorkspace').value;
      P.refreshRepoBaseEditors('batchRepoBases', 'batchProjects', wsId);
      P.syncContainerQueuedAutoRun('batchProjects');
    });
    P.$('#batchContainerImage')?.addEventListener('change', () => {
      P.onContainerImageChange('batchProjects');
    });
    // 项目勾选变化时，动态获取分支列表 + 逐仓基准分支
    P.$('#batchProjects').addEventListener('change', (e) => {
      if (e.target.classList.contains('project-radio')) {
        const wsId = P.$('#batchWorkspace').value;
        const checkedIds = P.getSelectedProjectIds('batchProjects');
        P.syncContainerAutoRun('batchProjects');
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

  P.updateCaptureStatus = function (en) {
    P.$('#captureStatus').textContent = P.t(en ? 'panelCapturing' : 'panelCaptureStopped');
  };

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
        el.innerHTML =
          nAll !== n5xx
            ? P.t('panelCapture5xxCountTotalHtml', { n: n5xx, total: nAll })
            : P.t('panelCapture5xxCountHtml', { n: n5xx });
      }
    } catch (_) { /* ignore */ }
  };

  P.clearCapturedErrors = async function () {
    try {
      await P.sendMessage({ action: 'clearCapturedErrors' });
    } catch (_) { /* ignore */ }
    await P.refreshCapturedCount();
    P.showR('batchResult', 'success', P.t('panelBatchCleared'));
  };

  /**
   * 批量创建成功收尾：先清空表单选项（项目/分支等），再提示（OPT-20260828-017）。
   * 与单请求路径 runAfterSuccess 顺序一致。
   */
  P.resetBatchCreateForm = function () {
    PanelCreateSuccess.resetBatchCreateFields(document, {
      emptyHint: CreateTaskPayload.repoBaseEmptyHint(),
      defaultDueDate: CreateTaskPayload.getDefaultTaskDeadline(),
    });
    P.syncContainerAutoRun('batchProjects');
  };

  P.onBatchWsChange = async function () {
    const id = P.$('#batchWorkspace').value;
    await Storage.saveLastWorkspace(id);
    if (!id) {
      const pickWsFirst = P.t('commonPickWsFirst');
      P.$('#batchProjects').innerHTML = `<p class="placeholder">${pickWsFirst}</p>`;
      P.$('#batchProgressColumn').innerHTML = `<option value="">${pickWsFirst}</option>`;
      if (P.$('#batchDeliverable')) P.$('#batchDeliverable').innerHTML = `<option value="">${pickWsFirst}</option>`;
      if (P.$('#batchRepoBases')) {
        P.$('#batchRepoBases').innerHTML = `<p class="placeholder">${CreateTaskPayload.repoBaseEmptyHint()}</p>`;
      }
      P.syncContainerAutoRun('batchProjects', false);
      await P.refreshWorkspaceScheduleEnabled('batchProjects', '', '');
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
      await P.loadGitIdentities(String(companyId));
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
    await P.refreshWorkspaceScheduleEnabled('batchProjects', id, companyId);
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
    const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
    const repoIdentities = GitId
      ? GitId.readRepoIdentitiesFromRoot(P.$('#batchGitIdentities'))
      : [];

    if (!wsId) return P.showR('batchResult', 'error', P.t('commonSelectWsError'));
    if (!checkedIds.length) return P.showR('batchResult', 'error', P.t('floatSelectProjectError'));
    if (!(await P.ensureApiReady())) return P.showR('batchResult', 'error', P.t('panelLoginRequired'));

    const featureGate = CreateTaskPayload.validateCreateTaskForm({
      title: 'batch',
      workspaceId: wsId,
      owner: 'pending',
      projectIds: checkedIds,
      projectsList: state.projectsCache[wsId] || [],
      feature_params_source: featureParamsSource,
      personal_feature_params_config_id: personalConfigId,
      auto_run: autoRun,
      container_image_id: containerImageId,
      repo_identities: repoIdentities,
    });
    if (featureGate) {
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
    if (!r.success || !r.data?.length) return P.showR('batchResult', 'error', P.t('panelNoCapturedErrors'));

    // 批量建任务仅针对 5xx（与插件角标示数一致）
    const errors = CaptureStatus.filterBadgeCountableRequests(r.data);
    if (!errors.length) {
      return P.showR('batchResult', 'error', P.t('panelNo5xxBuildable'));
    }
    const btn = P.$('#btnCreateBatch');
    btn.disabled = true; btn.textContent = P.t('panelCreatingBatch', { n: errors.length });
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
        return CreateTaskHardwareStock.payloadWithStock({
          title: `[${e.method}] ${P.extractPath(e.url)} → ${statusLabel}`,
          description: desc,
          priority: e.canceled || e.statusCode === 0 ? 'medium' : (e.statusCode >= 500 ? 'high' : 'medium'),
          workspaceId: wsId,
          projectsList: cached,
          projects,
          progress_column_id: progressColumnId,
          deliverable_obj_id: deliverableObjId,
          container_image_id: containerImageId,
          due_date: dueDate,
          auto_run: autoRun,
          queued_auto_run: Boolean(P.$('#batchQueuedAutoRun')?.checked),
          repo_identities: repoIdentities,
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
      const message = P.t('panelBatchCreateDone', { n: tasks.length });
      await P.sendMessage({ action: 'clearCapturedErrors' });
      await P.refreshCapturedCount();
      PanelCreateSuccess.runAfterSuccess({
        reset: () => P.resetBatchCreateForm(),
        showSuccess: (msg) => P.showR('batchResult', 'success', msg),
        message,
      });
    } catch (e) {
      P.showR('batchResult', 'error', P.t('panelCreateFailedWith', { msg: e.message }), e.traceId);
    } finally { btn.disabled = false; btn.textContent = P.t('panelBatchCreate'); }
  };
})();
