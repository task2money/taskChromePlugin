/**
 * 浮窗工作空间 / 项目 / 创建元数据表单。
 */
async function loadWorkspaces() {
  if (!isLoggedIn) {
    wsSelect.innerHTML = '<option value="">-- 请先登录 --</option>';
    return;
  }
  wsSelect.innerHTML = '<option value="">加载中...</option>';
  try {
    const data = await swApi('getWorkspaces');

    workspacesData = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
    if (!workspacesData.length) {
      wsSelect.innerHTML = '<option value="">(无工作空间)</option>';
      return;
    }
    wsSelect.innerHTML = '<option value="">-- 选择工作空间 --</option>';
    if (typeof WorkspaceList === 'undefined' || typeof WorkspaceList.workspaceOptionLabels !== 'function') {
      throw new Error('WorkspaceList helpers missing');
    }
    const labels = WorkspaceList.workspaceOptionLabels(workspacesData);
    for (let i = 0; i < workspacesData.length; i++) {
      const ws = workspacesData[i];
      const id = ws.id || ws._id;
      wsSelect.innerHTML += `<option value="${id}">${esc(labels[i])}</option>`;
    }
    await applyAidevMetaAfterWorkspacesLoaded();
  } catch (e) {
    console.warn('[taskChromePlugin] loadWorkspaces 失败:', e.message);
    if (handleApiAuthFailure(e)) {
      if (typeof setDataTraceId === 'function') setDataTraceId(wsSelect, e);
      return;
    }
    wsSelect.innerHTML = `<option value="">加载失败: ${e.message}</option>`;
    if (typeof setDataTraceId === 'function') setDataTraceId(wsSelect, e);
  }
}

function setAidevStatus(text, visible = true) {
  if (!aidevStatusEl) return;
  if (!visible || !text) {
    aidevStatusEl.hidden = true;
    aidevStatusEl.textContent = '';
    return;
  }
  aidevStatusEl.textContent = text;
  aidevStatusEl.hidden = false;
}

function checkAidevMatchingProjects(wsId) {
  if (!pendingAidevMatches?.length || typeof AidevMeta === 'undefined') return;
  const pids = AidevMeta.projectIdsForWorkspace(pendingAidevMatches, wsId);
  if (!pids.length) return;
  const available = Array.from(projectsDiv.querySelectorAll('input.project-radio')).map((el) => el.value);
  const pick = ProjectAutoRunLabel.pickSingleProjectId(pids, available);
  for (const el of projectsDiv.querySelectorAll('input.project-radio')) {
    el.checked = el.value === pick;
  }
}

async function applyAidevMetaAfterWorkspacesLoaded() {
  pendingAidevMatches = null;
  if (typeof AidevMeta === 'undefined') {
    setAidevStatus('', false);
    return;
  }

  const meta = AidevMeta.readAidevMetaFromDocument(document);
  if (!meta?.service_id) {
    setAidevStatus('', false);
    return;
  }

  try {
    const resp = await swApi('resolveAidevMeta', { serviceId: meta.service_id });
    const matches = Array.isArray(resp?.matches) ? resp.matches : [];
    setAidevStatus(AidevMeta.formatAidevResolveStatus(matches));
    if (!matches.length) return;

    pendingAidevMatches = matches;
    const wsIds = AidevMeta.uniqueWorkspaceIdsFromMatches(matches);
    if (wsIds.length === 1) {
      wsSelect.value = wsIds[0];
      await loadProjects(wsIds[0]);
      checkAidevMatchingProjects(wsIds[0]);
      await loadWorkspaceCreateMeta(wsIds[0]);
      refreshFloatRepoBases();
      await seedBranchDatalists([]);
    }
  } catch (e) {
    console.warn('[taskChromePlugin] aidev resolve 失败:', e.message);
    setAidevStatus(`元信息反查失败: ${e.message}`);
  }
}

function selectedFloatProjectIds() {
  if (!projectsDiv) return [];
  return Array.from(projectsDiv.querySelectorAll('input.project-radio:checked')).map((el) => el.value);
}

function syncFloatImageAppearance(project) {
  if (typeof ProjectAutoRunLabel === 'undefined'
      || typeof ProjectAutoRunLabel.resolveImageFieldAppearance !== 'function'
      || typeof ProjectAutoRunLabel.applyImageFieldAppearance !== 'function') {
    return;
  }
  const ap = ProjectAutoRunLabel.resolveImageFieldAppearance({
    projectAllowsAutoRun: ProjectAutoRunLabel.projectAllowsAutoRun(project),
  });
  ProjectAutoRunLabel.applyImageFieldAppearance(imageRequiredMark, imageSelect, ap);
}

function syncFloatAutoRun(checkedPreference) {
  if (typeof ProjectAutoRunLabel === 'undefined'
      || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
    syncFloatQueuedAutoRun();
    return;
  }
  const project = ProjectAutoRunLabel.findProjectById(projectsData, selectedFloatProjectIds()[0]);
  const hasImage = typeof ProjectAutoRunLabel.hasInstalledImageId === 'function'
    ? ProjectAutoRunLabel.hasInstalledImageId(imageSelect?.value)
    : Boolean(String(imageSelect?.value || '').trim());
  const pref = checkedPreference !== undefined
    ? Boolean(checkedPreference)
    : ProjectAutoRunLabel.projectAllowsAutoRun(project);
  const st = ProjectAutoRunLabel.resolveAutoRunControlState({
    selectedProject: project,
    checkedPreference: pref,
    hasInstalledImage: hasImage,
  });
  ProjectAutoRunLabel.applyAutoRunControlToElements(autoRunInput, autoRunHint, st);
  syncFloatImageAppearance(project);
  syncFloatQueuedAutoRun();
}

function syncFloatQueuedAutoRun() {
  if (typeof WorkspaceAutoSchedule === 'undefined') return;
  WorkspaceAutoSchedule.applyCreateTaskQueuedVisibility({
    wrapEl: queuedWrap,
    inputEl: queuedInput,
    show: WorkspaceAutoSchedule.shouldShowCreateTaskQueuedAutoRun({
      canEnableAutoRun: Boolean(autoRunInput && !autoRunInput.disabled),
      autoRun: Boolean(autoRunInput?.checked),
      workspaceScheduleEnabled,
    }),
  });
}

async function refreshWorkspaceScheduleEnabled(wsId, companyId) {
  workspaceScheduleEnabled = false;
  if (typeof WorkspaceAutoSchedule !== 'undefined') {
    WorkspaceAutoSchedule.clearFetchError(queuedError);
  }
  const wid = String(wsId || '').trim();
  const cid = String(companyId || '').trim();
  if (wid && cid) {
    try {
      const data = await swApi('getQueueSchedule', { companyId: cid, workspaceId: wid });
      if (typeof WorkspaceAutoSchedule !== 'undefined') {
        workspaceScheduleEnabled = WorkspaceAutoSchedule.isWorkspaceAutoScheduleEnabled(data);
      }
    } catch (e) {
      if (typeof WorkspaceAutoSchedule !== 'undefined') {
        WorkspaceAutoSchedule.showFetchError(queuedError, e);
      }
    }
  }
  syncFloatQueuedAutoRun();
}

async function loadProjects(wsId) {
  projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">加载中...</span>';
  try {
    const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
    const companyId = ws?.company_id || ws?.companyId;
    const data = await swApi('getProjects', { workspaceId: wsId, companyId });

    projectsData = Array.isArray(data) ? data : (data?.items || data?.data || []);
    if (!projectsData.length) {
      projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">无项目</span>';
      syncFloatAutoRun(false);
      return;
    }
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.renderProjectRadioHtml !== 'function'
        || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
      throw new Error('ProjectAutoRunLabel helpers missing');
    }
    let html = '';
    for (const p of projectsData) {
      html += ProjectAutoRunLabel.renderProjectRadioHtml(p, { name: 'taskplugin-project', esc });
    }
    projectsDiv.innerHTML = html;
    checkAidevMatchingProjects(wsId);
    syncFloatAutoRun();
  } catch (e) {
    console.warn('[taskChromePlugin] loadProjects 失败:', e.message);
    projectsData = [];
    syncFloatAutoRun(false);
    if (handleApiAuthFailure(e)) return;
    projectsDiv.innerHTML = `<span style="color:#f38ba8;font-size:11px;">加载失败: ${e.message}</span>`;
    if (typeof setDataTraceId === 'function') setDataTraceId(projectsDiv, e);
  }
}

function refreshFloatGitIdentities() {
  if (!gitIdentitiesDiv || typeof CreateTaskGitIdentity === 'undefined') return;
  const prevIdent = CreateTaskGitIdentity.readSelectionsMap(gitIdentitiesDiv);
  const pids = selectedFloatProjectIds();
  const GitId = CreateTaskGitIdentity;
  const wsId = wsSelect?.value || '';
  const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
  const companyId = ws?.company_id || ws?.companyId || '';
  gitIdentitiesDiv.innerHTML = GitId.buildEditorsHtml({
    projectIds: pids,
    projectsList: projectsData,
    identities: gitIdentitiesCache,
    previousByUrl: prevIdent,
    settingsHref: companyId ? GitId.settingsHref(companyId) : '',
    enabled: Boolean(autoRunInput?.checked),
  });
}

function refreshFloatRepoBases() {
  if (!repoBasesDiv || typeof CreateTaskPayload === 'undefined') return;
  const prev = CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv);
  const pids = selectedFloatProjectIds();
  repoBasesDiv.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
    projectIds: pids,
    projectsList: projectsData,
    previousValues: prev,
    inputClass: 'taskplugin-input',
    emptyHint: CreateTaskPayload.REPO_BASE_EMPTY_HINT,
  });
  refreshFloatGitIdentities();
  populateFloatRepoBaseDatalists();
}

function renderAssignees() {
  if (!assigneesDiv) return;
  if (!membersData.length) {
    assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">暂无成员</span>';
    return;
  }
  let html = '';
  for (const m of membersData) {
    const mid = String(m.id);
    const name = m.member_name || m.name || mid;
    html += `<label><input type="checkbox" class="taskplugin-assignee" value="${esc(mid)}"> ${esc(name)}</label>`;
  }
  assigneesDiv.innerHTML = html;
}

function getSelectedAssigneeIds() {
  if (!assigneesDiv) return [];
  return Array.from(assigneesDiv.querySelectorAll('.taskplugin-assignee:checked')).map((cb) => cb.value);
}

// ---- 事件 ----
wsSelect.addEventListener('change', async () => {
  const wsId = wsSelect.value;
  if (!wsId) {
    projectsDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">请先选择工作空间</span>';
    if (progressSelect) progressSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
    if (deliverableSelect) deliverableSelect.innerHTML = '<option value="">-- 请先选择工作空间 --</option>';
    if (repoBasesDiv) {
      repoBasesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">'
        + CreateTaskPayload.REPO_BASE_EMPTY_HINT + '</span>';
    }
    if (assigneesDiv) assigneesDiv.innerHTML = '<span style="color:#6c7086;font-size:11px;">选择工作空间后加载</span>';
    membersData = [];
    projectsData = [];
    syncFloatAutoRun(false);
    await refreshWorkspaceScheduleEnabled('', '');
    await seedBranchDatalists([]);
    return;
  }
  await loadProjects(wsId);
  await loadWorkspaceCreateMeta(wsId);
  refreshFloatRepoBases();
  await seedBranchDatalists([]);
});

featureParamsSelect?.addEventListener('change', () => {
  if (personalWrap) {
    personalWrap.style.display = featureParamsSelect.value === 'personal' ? '' : 'none';
  }
});

workBranch.addEventListener('change', () => applyPresetIfNeeded(workBranch));
mergeTarget.addEventListener('change', () => applyPresetIfNeeded(mergeTarget));

projectsDiv.addEventListener('change', async (e) => {
  if (e.target.type !== 'radio' || !e.target.classList.contains('project-radio')) return;
  const wsId = wsSelect.value;
  const pids = selectedFloatProjectIds();
  syncFloatAutoRun();
  refreshFloatRepoBases();
  await fetchBranchesForFloatingPanel(wsId, pids);
});

autoRunInput?.addEventListener('change', () => {
  refreshFloatRepoBases();
  syncFloatQueuedAutoRun();
});

imageSelect?.addEventListener('change', () => {
  const wasEnabled = Boolean(autoRunInput && !autoRunInput.disabled);
  syncFloatAutoRun(wasEnabled ? Boolean(autoRunInput?.checked) : undefined);
  refreshFloatGitIdentities();
});

async function loadWorkspaceCreateMeta(wsId) {
  const ws = workspacesData.find(w => String(w.id || w._id) === String(wsId));
  const companyId = ws?.company_id || ws?.companyId;
  await refreshWorkspaceScheduleEnabled(wsId, companyId);
  if (!companyId) return;
  try {
    const cid = String(companyId);
    const [colsResp, delivResp, imagesResp, personalResp, membersResp, identResp] = await Promise.all([
      swApi('fetchProgressColumns', { companyId: cid, workspaceId: wsId }).catch((e) => ({ __err: e })),
      swApi('getDeliverableTypes', { companyId: cid, workspaceId: wsId }).catch((e) => ({ __err: e })),
      swApi('getInstalledImages', { companyId: cid }).catch((e) => ({ __err: e })),
      swApi('getPersonalFeatureParamsConfigs').catch((e) => ({ __err: e })),
      swApi('getMembers', { companyId: cid }).catch((e) => ({ __err: e })),
      swApi('listGitIdentities', { companyId: cid }).catch((e) => ({ __err: e })),
    ]);

    if (progressSelect && !colsResp.__err) {
      const columns = colsResp?.columns || [];
      progressSelect.innerHTML = columns.length
        ? columns.map((c) => `<option value="${esc(String(c.id))}">${esc(c.name || c.id)}</option>`).join('')
        : '<option value="">无进度列</option>';
    }
    if (deliverableSelect && !delivResp.__err) {
      const types = delivResp?.current_deliverable_objs || [];
      deliverableSelect.innerHTML = types.length
        ? types.map((t) => `<option value="${esc(String(t.id))}">${esc(t.name || t.id)}</option>`).join('')
        : '<option value="">无可用类别</option>';
    }
    if (imageSelect && !imagesResp.__err) {
      const images = Array.isArray(imagesResp) ? imagesResp : (imagesResp?.results || imagesResp?.items || imagesResp?.data || []);
      let h = '<option value="">无</option>';
      for (const img of images) {
        const id = img.id || img._id;
        h += `<option value="${esc(String(id))}">${esc(`${img.name || id}:${img.version || img.tag || 'latest'}`)}</option>`;
      }
      imageSelect.innerHTML = h;
      if (images.length === 1) imageSelect.value = String(images[0].id || images[0]._id);
      syncFloatAutoRun();
    }
    if (personalConfigSelect && !personalResp.__err) {
      const configs = personalResp?.configs || (Array.isArray(personalResp) ? personalResp : []);
      personalConfigSelect.innerHTML = '<option value="">-- 请选择个人配置 --</option>'
        + configs.map((c) => `<option value="${esc(String(c.id || c._id))}">${esc(c.name || c.title || c.id)}</option>`).join('');
    }
    if (!membersResp.__err) {
      membersData = Array.isArray(membersResp) ? membersResp : (membersResp?.results || membersResp?.data || []);
      renderAssignees();
    }
    const GitId = typeof CreateTaskGitIdentity !== 'undefined' ? CreateTaskGitIdentity : null;
    gitIdentitiesCache = (!identResp.__err && GitId)
      ? GitId.unwrapIdentities(identResp)
      : [];
    refreshFloatRepoBases();
    if (dueDateInput && !dueDateInput.value && typeof CreateTaskPayload !== 'undefined') {
      dueDateInput.value = CreateTaskPayload.getDefaultTaskDeadline();
    }
  } catch (e) {
    console.warn('[taskChromePlugin] loadWorkspaceCreateMeta 失败:', e.message);
  }
}

// 提交
submitBtn.addEventListener('click', async () => {
  if (!isLoggedIn) {
    showResult('请先在扩展弹窗中登录', 'error');
    return;
  }

  const wsId = wsSelect.value;
  const pids = selectedFloatProjectIds();
  const title = titleInput.value.trim();
  const desc = descInput.value.trim();
  const priority = document.getElementById('taskplugin-priority').value;

  if (!wsId) return showResult('请选择工作空间', 'error');
  if (!pids.length) return showResult('请选择一个项目', 'error');
  if (!title) return showResult('请输入任务标题', 'error');

  submitBtn.disabled = true;
  submitBtn.textContent = '创建中...';

  try {
    const mappingResp = await sendMessageWithTimeout({ action: 'getEndpointMapping' }, 5000);
    const endpointMapping = mappingResp.success ? mappingResp.data : null;
    const owner = await resolveTaskOwner(endpointMapping, wsId);
    if (!owner) {
      showResult('无法确定任务负责人，请在扩展 Popup 中重新登录', 'error');
      return;
    }

    const wb = workBranch.value.trim();
    const mt = mergeTarget.value.trim();
    const repoBaseBranches = CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv);

    let fullDesc = desc;
    const sourceInfo = [
      `---`,
      `**来源页面**: ${window.location.href}`,
      `**页面标题**: ${document.title}`,
    ];
    fullDesc = fullDesc + '\n\n' + sourceInfo.join('\n');

    const form = {
      title,
      description: fullDesc,
      priority,
      workspaceId: wsId,
      projectIds: pids,
      projectsList: projectsData,
      owner,
      assignees: getSelectedAssigneeIds(),
      progress_column_id: progressSelect?.value || '',
      deliverable_obj_id: deliverableSelect?.value || '',
      container_image_id: imageSelect?.value || '',
      feature_params_source: featureParamsSelect?.value || '',
      personal_feature_params_config_id: personalConfigSelect?.value || '',
      due_date: dueDateInput?.value || '',
      auto_run: Boolean(autoRunInput?.checked),
      queued_auto_run: Boolean(queuedInput?.checked),
      workBranch: wb,
      mergeTarget: mt,
      repoBaseBranches,
      repo_identities: (typeof CreateTaskGitIdentity !== 'undefined' && gitIdentitiesDiv)
        ? CreateTaskGitIdentity.readRepoIdentitiesFromRoot(gitIdentitiesDiv)
        : [],
    };

    const blocked = CreateTaskPayload.validateCreateTaskForm(form);
    if (blocked) {
      showResult(blocked, 'error');
      return;
    }

    const taskData = CreateTaskPayload.buildCreateTaskPayload(form);

    const resp = await sendMessageWithTimeout({
      action: 'createTask',
      baseUrl: apiCfg.baseUrl,
      token: apiCfg.token,
      endpointMapping: mappingResp.success ? mappingResp.data : undefined,
      taskData,
    }, 15000);

    if (!resp?.success) {
      if (handleApiAuthFailure({ message: resp?.error })) {
        showResult('会话失效，请重新登录', 'error');
        return;
      }
      const err = new Error(resp?.error || '创建失败');
      const tid = extractTraceId(resp);
      if (tid) err.traceId = tid;
      throw err;
    }

    const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
    const taskId = AfterCreate
      ? AfterCreate.extractCreatedTaskId(resp.data)
      : (resp.data?.id || resp.data?._id || '(已创建)');
    const toastMsg = AfterCreate
      ? AfterCreate.formatFloatCreateSuccessToast(taskId)
      : `✅ 任务创建成功! ID: ${taskId}`;

    hideFloatPanel();
    try {
      await restoreOpenSnapshot(openSnapshot);
    } catch (restoreErr) {
      console.warn('[taskChromePlugin] restoreOpenSnapshot 失败:', restoreErr?.message || restoreErr);
      titleInput.value = '';
      descInput.value = '';
      syncDescResetButton();
    }
    showPageToast(toastMsg);
  } catch (e) {
    showResult(`❌ 创建失败: ${e.message}`, 'error', e.traceId);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '✅ 创建任务';
  }
});

// ---- 工具 ----
