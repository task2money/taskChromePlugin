/**
 * Panel 工作空间/项目/成员加载（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js）与分支工具（branches.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.loadMembers = async function (companyId, wsId) {
    const sel = P.$('#singleOwner');
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await P.ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    // OPT-20260820-040: 缓存按工作空间隔离（不同工作空间协作人不同）
    const cacheKey = `${companyId}:${wsId || ''}`;
    if (state.membersCache[cacheKey]) {
      P.renderMemberOptions(cacheKey);
      return;
    }
    try {
      const data = await P.swApi('getMembers', { companyId, workspaceId: wsId });
      const members = Array.isArray(data) ? data : (data?.results || data?.data || []);
      state.membersCache[cacheKey] = members;
      P.renderMemberOptions(cacheKey);
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  };

  P.renderMemberOptions = function (cacheKey) {
    const members = state.membersCache[cacheKey] || [];
    const sel = P.$('#singleOwner');
    sel.innerHTML = '<option value="">-- 请选择负责人 --</option>';
    let defaultMemberId = '';
    // 优先用登录响应中的 member_id 精确匹配
    if (state.currentMemberId && members.some(m => String(m.id) === state.currentMemberId)) {
      defaultMemberId = state.currentMemberId;
    }
    for (const m of members) {
      const mid = String(m.id);
      const name = m.member_name || m.name || mid;
      // workspace-collaborators 载荷用 user 字段（与 company_members 的 user_id 不同）
      const uid = String(m.user || m.user_id || m.userId || '');
      sel.innerHTML += `<option value="${mid}" data-user-id="${uid}">${P.escHtml(name)}</option>`;
      // 回退：user 匹配
      if (!defaultMemberId && state.currentUserId && uid === state.currentUserId) {
        defaultMemberId = mid;
      }
    }
    if (defaultMemberId) {
      sel.value = defaultMemberId;
    } else if (members.length === 1) {
      sel.value = String(members[0].id);
    }
    P.renderAssigneeCheckboxes(cacheKey);
  };

  P.loadProgressColumns = async function (companyId, wsId, selectId) {
    const sel = P.$(`#${selectId}`);
    sel.innerHTML = '<option value="">加载中...</option>';
    const cacheKey = `${companyId}:${wsId}`;
    if (state.progressColumnsCache[cacheKey]) {
      P.renderProgressColumnOptions(selectId, cacheKey);
      return;
    }
    if (!(await P.ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await P.swApi('fetchProgressColumns', { companyId, workspaceId: wsId });
      const columns = data?.columns || [];
      state.progressColumnsCache[cacheKey] = columns;
      P.renderProgressColumnOptions(selectId, cacheKey);
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  };

  P.renderProgressColumnOptions = function (selectId, cacheKey) {
    const columns = state.progressColumnsCache[cacheKey] || [];
    const sel = P.$(`#${selectId}`);
    sel.innerHTML = '<option value="">-- 自动 --</option>';
    for (const col of columns) {
      const cid = String(col.id);
      const name = col.name || cid;
      sel.innerHTML += `<option value="${cid}">${P.escHtml(name)}</option>`;
    }
    if (columns.length > 0) sel.value = String(columns[0].id);
  };

  P.loadWorkspaces = async function (selectId) {
    const sel = P.$(`#${selectId}`);
    if (!sel) return;
    if (!(await P.ensureApiReady())) {
      sel.innerHTML = `<option value="">-- ${state.apiConfig.token ? '会话过期，请重新登录' : '请先登录'} --</option>`;
      return;
    }
    sel.innerHTML = '<option value="">加载中...</option>';
    try {
      const data = await P.swApi('getWorkspaces');
      state.workspaces = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      P.renderWorkspaceOptions(selectId);
      const aidevWsId = await P.applyAidevMetaAfterWorkspacesLoaded(selectId);
      if (aidevWsId && state.workspaces.some((w) => String(w.id || w._id) === String(aidevWsId))) {
        sel.value = aidevWsId;
      } else {
        const last = await Storage.getLastWorkspace();
        if (last && state.workspaces.some((w) => (w.id || w._id) === last)) {
          sel.value = last;
        } else if (state.workspaces.length === 1) {
          sel.value = state.workspaces[0].id || state.workspaces[0]._id;
        }
      }
      sel.dispatchEvent(new Event('change'));
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">-- 请在扩展中重新登录 --</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    }
  };

  P.renderWorkspaceOptions = function (selectId) {
    const sel = P.$(`#${selectId}`);
    sel.innerHTML = '<option value="">-- 请选择工作空间 --</option>';
    if (typeof WorkspaceList === 'undefined' || typeof WorkspaceList.workspaceOptionLabels !== 'function') {
      throw new Error('WorkspaceList helpers missing');
    }
    const labels = WorkspaceList.workspaceOptionLabels(state.workspaces);
    for (let i = 0; i < state.workspaces.length; i++) {
      const ws = state.workspaces[i];
      const id = ws.id || ws._id;
      sel.innerHTML += `<option value="${id}">${P.escHtml(labels[i])}</option>`;
    }
  };

  P.onSingleWorkspaceChange = async function () {
    const wsId = P.$('#singleWorkspace').value;
    await Storage.saveLastWorkspace(wsId);
    if (!wsId) {
      P.$('#singleProjects').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      P.$('#singleOwner').innerHTML = '<option value="">请先选择工作空间</option>';
      P.$('#singleProgressColumn').innerHTML = '<option value="">请先选择工作空间</option>';
      P.$('#singleDeliverable').innerHTML = '<option value="">请先选择工作空间</option>';
      P.$('#singleAssignees').innerHTML = '<p class="placeholder">请先选择工作空间</p>';
      if (P.$('#singleRepoBases')) {
        P.$('#singleRepoBases').innerHTML = `<p class="placeholder">${CreateTaskPayload.REPO_BASE_EMPTY_HINT}</p>`;
      }
      P.syncContainerAutoRun('singleProjects', false);
      await P.refreshWorkspaceScheduleEnabled('singleProjects', '', '');
      P.fetchAndPopulateBranches('singleWorkBranchList', '', [], 'work');
      P.fetchAndPopulateBranches('singleMergeTargetList', '', [], 'merge');
      return;
    }
    const ws = state.workspaces.find(w => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    await P.loadProjects(wsId, 'singleProjects', companyId);
    if (companyId) {
      await P.loadMembers(String(companyId), wsId);
      await P.loadProgressColumns(String(companyId), wsId, 'singleProgressColumn');
      await P.loadDeliverableTypes(String(companyId), wsId);
      await P.loadInstalledImages(String(companyId));
      await P.loadGitIdentities(String(companyId));
    }
    await P.loadPersonalFeatureParamsConfigs();
    P.initSingleDueDateDefault();
    // 恢复选中后加载分支
    const checkedIds = P.getSelectedProjectIds('singleProjects');
    if (checkedIds.length) {
      P.fetchSingleBranchLists(wsId, checkedIds);
    } else {
      P.fetchAndPopulateBranches('singleWorkBranchList', wsId, [], 'work');
      P.fetchAndPopulateBranches('singleMergeTargetList', wsId, [], 'merge');
    }
    P.refreshRepoBaseEditors('singleRepoBases', 'singleProjects', wsId);
    await P.refreshWorkspaceScheduleEnabled('singleProjects', wsId, companyId);
  };

  P.initSingleDueDateDefault = function () {
    P.initDueDateDefault('singleDueDate');
  };

  P.loadDeliverableTypes = async function (companyId, wsId) {
    return P.loadDeliverableTypesInto('singleDeliverable', companyId, wsId);
  };

  P.loadInstalledImages = async function (companyId) {
    return P.loadInstalledImagesInto('singleContainerImage', companyId);
  };

  P.loadPersonalFeatureParamsConfigs = async function () {
    return P.loadPersonalFeatureParamsInto('singlePersonalConfig');
  };

  P.renderAssigneeCheckboxes = function (cacheKey) {
    const box = P.$('#singleAssignees');
    if (!box) return;
    const members = state.membersCache[cacheKey] || [];
    if (!members.length) {
      box.innerHTML = '<p class="placeholder">暂无成员</p>';
      return;
    }
    let h = '';
    for (const m of members) {
      const mid = String(m.id);
      const name = m.member_name || m.name || mid;
      h += `<label><input type="checkbox" class="assignee-check" value="${P.escHtml(mid)}"> ${P.escHtml(name)}</label>`;
    }
    box.innerHTML = h;
  };

  P.getSelectedAssigneeIds = function () {
    return Array.from(document.querySelectorAll('#singleAssignees .assignee-check:checked')).map((cb) => cb.value);
  };

  P.refreshGitIdentityEditors = function (identityContainerId, projectsContainerId, wsId, autoRunId) {
    const box = P.$(`#${identityContainerId}`);
    if (!box) return;
    const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
    if (!GitId) {
      box.innerHTML = '';
      return;
    }
    const prevIdent = GitId.readSelectionsMap(box);
    const ids = P.getSelectedProjectIds(projectsContainerId);
    const list = state.projectsCache[wsId] || [];
    const ws = state.workspaces.find((w) => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId || '';
    box.innerHTML = GitId.buildEditorsHtml({
      projectIds: ids,
      projectsList: list,
      identities: state.gitIdentities || [],
      previousByUrl: prevIdent,
      settingsHref: companyId ? GitId.settingsHref(companyId) : '',
      enabled: Boolean(P.$(`#${autoRunId}`)?.checked),
    });
  };

  P.refreshRepoBaseEditors = function (repoContainerId, projectsContainerId, wsId) {
    const box = P.$(`#${repoContainerId}`);
    if (!box) return;
    const prev = CreateTaskPayload.readRepoBaseBranchesFromRoot(box);
    const ids = P.getSelectedProjectIds(projectsContainerId);
    const list = state.projectsCache[wsId] || [];
    box.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
      projectIds: ids,
      projectsList: list,
      previousValues: prev,
      inputClass: 'form-input',
      emptyHint: CreateTaskPayload.REPO_BASE_EMPTY_HINT,
    });
    const identityId = repoContainerId === 'batchRepoBases' ? 'batchGitIdentities' : 'singleGitIdentities';
    const autoRunId = repoContainerId === 'batchRepoBases' ? 'batchAutoRun' : 'singleAutoRun';
    P.refreshGitIdentityEditors(identityId, projectsContainerId, wsId, autoRunId);
  };

  P.loadGitIdentities = async function (companyId) {
    state.gitIdentities = [];
    const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
    if (!companyId || !(await P.ensureApiReady())) return;
    try {
      const data = await P.swApi('listGitIdentities', { companyId: String(companyId) });
      state.gitIdentities = GitId ? GitId.unwrapIdentities(data) : [];
    } catch (e) {
      console.warn('[taskChromePlugin] loadGitIdentities 失败:', e.message);
      state.gitIdentities = [];
    }
  };

  P.initDueDateDefault = function (inputId) {
    const el = P.$(`#${inputId}`);
    if (!el || el.value) return;
    if (typeof CreateTaskPayload !== 'undefined') {
      el.value = CreateTaskPayload.getDefaultTaskDeadline();
    }
  };

  P.loadDeliverableTypesInto = async function (selectId, companyId, wsId) {
    const sel = P.$(`#${selectId}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await P.ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await P.swApi('getDeliverableTypes', { companyId, workspaceId: wsId });
      const types = data?.current_deliverable_objs || [];
      sel.innerHTML = types.length
        ? types.map((t) => `<option value="${P.escHtml(String(t.id))}">${P.escHtml(t.name || t.id)}</option>`).join('')
        : '<option value="">无可用交付物类别</option>';
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${P.escHtml(e.message)}</option>`;
    }
  };

  P.loadInstalledImagesInto = async function (selectId, companyId) {
    const sel = P.$(`#${selectId}`);
    if (!sel) return;
    sel.innerHTML = '<option value="">加载中...</option>';
    if (!(await P.ensureApiReady())) {
      sel.innerHTML = '<option value="">请先登录</option>';
      return;
    }
    try {
      const data = await P.swApi('getInstalledImages', { companyId });
      const images = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      let h = '<option value="">无</option>';
      for (const img of images) {
        const iid = img.id || img._id;
        const label = `${img.name || iid}:${img.version || img.tag || 'latest'}`;
        h += `<option value="${P.escHtml(String(iid))}">${P.escHtml(label)}</option>`;
      }
      sel.innerHTML = h;
      if (images.length === 1) sel.value = String(images[0].id || images[0]._id);
      const containerId = selectId === 'batchContainerImage' ? 'batchProjects' : 'singleProjects';
      P.syncContainerAutoRun(containerId);
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        sel.innerHTML = '<option value="">请重新登录</option>';
        return;
      }
      sel.innerHTML = `<option value="">加载失败: ${P.escHtml(e.message)}</option>`;
    }
  };

  P.loadPersonalFeatureParamsInto = async function (selectId) {
    const sel = P.$(`#${selectId}`);
    if (!sel) return;
    if (!(await P.ensureApiReady())) return;
    try {
      const data = await P.swApi('getPersonalFeatureParamsConfigs');
      const configs = data?.configs || (Array.isArray(data) ? data : []);
      let h = '<option value="">-- 请选择个人配置 --</option>';
      for (const c of configs) {
        const cid = c.id || c._id;
        h += `<option value="${P.escHtml(String(cid))}">${P.escHtml(c.name || c.title || cid)}</option>`;
      }
      sel.innerHTML = h;
    } catch (e) {
      console.warn('[taskChromePlugin] loadPersonalFeatureParamsInto:', e.message);
      sel.innerHTML = `<option value="">加载失败: ${P.escHtml(e.message)}</option>`;
    }
  };

  P.loadProjects = async function (wsId, containerId, companyId) {
    const c = P.$(`#${containerId}`);
    c.innerHTML = '<p class="placeholder">加载中...</p>';
    if (!(await P.ensureApiReady())) {
      c.innerHTML = '<p class="placeholder">请先登录</p>';
      P.syncContainerAutoRun(containerId, false);
      return;
    }
    if (state.projectsCache[wsId]) {
      P.renderProjectCheckboxes(containerId, state.projectsCache[wsId]);
      await P.restoreProjectSelection(containerId);
      P.checkPanelAidevMatchingProjects(containerId, wsId);
      return;
    }
    try {
      const data = await P.swApi('getProjects', { workspaceId: wsId, companyId });
      const projs = Array.isArray(data) ? data : (data?.items || data?.data || []);
      state.projectsCache[wsId] = projs;
      P.renderProjectCheckboxes(containerId, projs);
      await P.restoreProjectSelection(containerId);
      P.checkPanelAidevMatchingProjects(containerId, wsId);
    } catch (e) {
      if (P.handleApiAuthFailure(e)) {
        c.innerHTML = '<p class="placeholder">请重新登录</p>';
        P.syncContainerAutoRun(containerId, false);
        return;
      }
      c.innerHTML = `<p class="placeholder">加载失败: ${e.message}</p>`;
      P.syncContainerAutoRun(containerId, false);
    }
  };

  P.setPanelAidevStatus = function (text, visible = true) {
    const el = P.$('#panel-aidev-status');
    if (!el) return;
    if (!visible || !text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.textContent = text;
    el.hidden = false;
  };

  P.applyAidevMetaAfterWorkspacesLoaded = async function (selectId) {
    state.pendingAidevMatches = null;
    if (typeof AidevMeta === 'undefined') {
      P.setPanelAidevStatus('', false);
      return null;
    }

    const meta = await AidevMeta.readAidevMetaFromInspectedWindow();
    if (!meta?.service_id) {
      P.setPanelAidevStatus('', false);
      return null;
    }

    if (selectId !== 'singleWorkspace') return null;

    try {
      const resp = await P.swApi('resolveAidevMeta', { serviceId: meta.service_id });
      const matches = Array.isArray(resp?.matches) ? resp.matches : [];
      P.setPanelAidevStatus(AidevMeta.formatAidevResolveStatus(matches));
      if (!matches.length) return null;

      state.pendingAidevMatches = matches;
      const wsIds = AidevMeta.uniqueWorkspaceIdsFromMatches(matches);
      return wsIds.length === 1 ? wsIds[0] : null;
    } catch (e) {
      console.warn('[taskChromePlugin] panel aidev resolve:', e.message);
      P.setPanelAidevStatus(`元信息反查失败: ${e.message}`);
      return null;
    }
  };
})();
