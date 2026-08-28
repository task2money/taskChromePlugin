/**
 * 浮窗分支 datalist、打开快照还原。
 */
function getWorkPresetDatalistOptions() {
  return [
    { value: `${PRESET_PREFIX}work:feature`, label: '【模板】feature' },
    { value: `${PRESET_PREFIX}work:bugfix`, label: '【模板】bugfix' },
    { value: `${PRESET_PREFIX}work:hotfix`, label: '【模板】hotfix' },
    { value: `${PRESET_PREFIX}work:release`, label: '【模板】release' },
  ];
}

function getMergePresetDatalistOptions() {
  const opts = [
    { value: `${PRESET_PREFIX}merge:develop`, label: '【模板】develop' },
    { value: `${PRESET_PREFIX}merge:main`, label: '【模板】main' },
  ];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startWeek = dayOfWeek > 4 ? 1 : 0;
  const labels = dayOfWeek > 4
    ? ['下周四', '下下周四', '下下下周四']
    : ['本周四', '下周四', '下下周四'];
  for (let i = 0; i < 3; i++) {
    const ymd = getThursdayYmd(startWeek + i);
    opts.push({
      value: `${PRESET_PREFIX}merge:release:${startWeek + i}`,
      label: `【模板】release/${ymd} (${labels[i] || `第${startWeek + i + 1}个周四`})`,
    });
  }
  return opts;
}

function applyPresetIfNeeded(inputEl) {
  const v = inputEl.value;
  if (!v.startsWith(PRESET_PREFIX)) return;
  const rest = v.slice(PRESET_PREFIX.length);
  if (rest.startsWith('work:')) {
    inputEl.value = buildWorkBranchName(rest.slice(5));
  } else if (rest.startsWith('merge:')) {
    inputEl.value = buildMergeBranchName(rest.slice(6));
  }
}

function renderBranchDatalist(datalistId, presetOptions, gitOptions) {
  const datalist = document.getElementById(datalistId);
  if (!datalist) return;
  datalist.innerHTML = '';
  for (const p of presetOptions) {
    datalist.innerHTML += `<option value="${esc(p.value)}">${esc(p.label)}</option>`;
  }
  for (const g of gitOptions) {
    datalist.innerHTML += `<option value="${esc(g.value)}">${esc(g.label)}</option>`;
  }
}

function seedBranchDatalists(gitOptions = []) {
  renderBranchDatalist('taskplugin-work-branch-list', getWorkPresetDatalistOptions(), gitOptions);
  renderBranchDatalist('taskplugin-merge-list', getMergePresetDatalistOptions(), gitOptions);
}

async function fetchBranchesForFloatingPanel(wsId, pids) {
  const gitOptions = await loadBranchOptions(wsId, pids);
  seedBranchDatalists(gitOptions);
}

async function loadBranchOptions(wsId, pids) {
  if (!wsId || !pids.length) return [];

  const ws = workspacesData.find(w => (w.id || w._id) === wsId);
  const companyId = ws?.company_id || ws?.companyId;
  if (!companyId) return [];

  const options = [];
  const seen = new Set();
  for (const b of ['develop', 'main']) {
    seen.add(b);
    options.push({ value: b, label: `${b}  [内置]` });
  }

  for (const pid of pids.slice(0, 3)) {
    const proj = projectsData.find(p => String(p.id || p._id) === String(pid));
    const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
    const repoUrl = repos[0];
    if (!repoUrl) continue;

    try {
      const resp = await swApi('getBranches', {
        companyId: String(companyId),
        projectId: pid,
        repoUrl,
      });
      const branches = Array.isArray(resp?.branches) ? resp.branches : (Array.isArray(resp) ? resp : []);
      for (const b of branches) {
        const name = typeof b === 'string' ? b : (b.name || b.branch_name || '');
        if (name && !seen.has(name)) {
          seen.add(name);
          const shortRepo = extractRepoLabel(repoUrl);
          const label = shortRepo ? `${name}  [${shortRepo}]` : name;
          options.push({ value: name, label });
        }
      }
    } catch (_) { /* ignore */ }
  }
  return options;
}

async function populateFloatRepoBaseDatalists() {
  if (!repoBasesDiv || typeof CreateTaskPayload === 'undefined') return;
  if (typeof CreateTaskPayload.parseRemoteBranchNames !== 'function'
      || typeof CreateTaskPayload.branchDatalistOptionsHtml !== 'function') {
    return;
  }
  const wsId = wsSelect?.value || '';
  if (!wsId) return;
  const ws = workspacesData.find((w) => String(w.id || w._id) === String(wsId));
  const companyId = ws?.company_id || ws?.companyId;
  if (!companyId) return;

  const inputs = repoBasesDiv.querySelectorAll('[data-repo-base][data-project-id][list]');
  for (const input of inputs) {
    const projectId = input.getAttribute('data-project-id');
    const repoIndex = Number(input.getAttribute('data-repo-index') || 0);
    const listId = input.getAttribute('list');
    const datalist = listId ? document.getElementById(listId) : null;
    if (!datalist) continue;
    const proj = projectsData.find((p) => String(p.id || p._id) === String(projectId));
    const repos = Array.isArray(proj?.git_repos)
      ? proj.git_repos.filter((u) => u && String(u).trim())
      : [];
    const repoUrl = repos[repoIndex];
    if (!repoUrl) continue;
    try {
      const resp = await swApi('getBranches', {
        companyId: String(companyId),
        projectId,
        repoUrl,
      });
      const names = CreateTaskPayload.parseRemoteBranchNames(resp);
      datalist.innerHTML = CreateTaskPayload.branchDatalistOptionsHtml(names);
    } catch (e) {
      console.warn('[taskChromePlugin] float repo-base getBranches failed', {
        projectId,
        repoIndex,
        message: e && e.message ? String(e.message) : 'unknown',
        traceId: e && e.traceId ? String(e.traceId) : '',
      });
    }
  }
}

function extractRepoLabel(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\.git$/, '').replace(/^\//, '');
    const parts = path.split('/');
    if (parts.length >= 2) return parts.slice(-2).join('/');
    return u.hostname;
  } catch (_) { return ''; }
}

function getThursdayYmd(weekOffset = 0) {
  const d = new Date();
  const dayOfWeek = d.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  d.setDate(d.getDate() + daysUntilThursday + weekOffset * 7);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildMergeBranchName(presetType) {
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

function buildWorkBranchName(presetType) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const titleSlug = (titleInput.value.trim() || 'task')
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '')
    .slice(0, 40) || 'task';
  if (presetType === 'release') {
    return `release/${today}_aidev\${taskId}`;
  }
  if (presetType === 'feature' || presetType === 'bugfix' || presetType === 'hotfix') {
    return `${presetType}/${today}_aidev\${taskId}_${titleSlug}`;
  }
  return '';
}

function showResult(msg, type, traceId) {
  resultDiv.textContent = msg;
  resultDiv.className = `taskplugin-result taskplugin-show taskplugin-result-${type}`;
  if (type === 'error') {
    setDataTraceId(resultDiv, traceId);
  } else {
    setDataTraceId(resultDiv, '');
  }
  setTimeout(() => {
    resultDiv.className = 'taskplugin-result';
    resultDiv.removeAttribute('data-traceId');
  }, 6000);
}

function captureOpenSnapshot() {
  const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
  const raw = {
    workspaceId: wsSelect.value || '',
    projectIds: selectedFloatProjectIds(),
    title: titleInput.value,
    description: descInput.value,
    priority: document.getElementById('taskplugin-priority')?.value || '1',
    progress_column_id: progressSelect?.value || '',
    deliverable_obj_id: deliverableSelect?.value || '',
    container_image_id: imageSelect?.value || '',
    feature_params_source: featureParamsSelect?.value || '',
    personal_feature_params_config_id: personalConfigSelect?.value || '',
    due_date: dueDateInput?.value || '',
    auto_run: Boolean(autoRunInput?.checked),
    repoBaseBranches: (typeof CreateTaskPayload !== 'undefined' && repoBasesDiv)
      ? CreateTaskPayload.readRepoBaseBranchesFromRoot(repoBasesDiv)
      : {},
    assigneeIds: getSelectedAssigneeIds(),
    workBranch: workBranch.value,
    mergeTarget: mergeTarget.value,
  };
  return AfterCreate ? AfterCreate.normalizeOpenSnapshot(raw) : raw;
}

function applyScalarFieldsFromSnapshot(snap) {
  titleInput.value = snap.title || '';
  descInput.value = snap.description || '';
  syncDescResetButton();
  const priorityEl = document.getElementById('taskplugin-priority');
  if (priorityEl) priorityEl.value = snap.priority || '1';
  if (workBranch) workBranch.value = snap.workBranch || '';
  if (mergeTarget) mergeTarget.value = snap.mergeTarget || '';
  if (featureParamsSelect) {
    featureParamsSelect.value = snap.feature_params_source || '';
    if (personalWrap) {
      personalWrap.style.display = featureParamsSelect.value === 'personal' ? '' : 'none';
    }
  }
}

async function restoreOpenSnapshot(snap) {
  if (!snap) {
    titleInput.value = '';
    descInput.value = '';
    syncDescResetButton();
    return;
  }
  const AfterCreate = typeof FloatPanelAfterCreate !== 'undefined' ? FloatPanelAfterCreate : null;
  const normalized = AfterCreate ? AfterCreate.normalizeOpenSnapshot(snap) : snap;

  applyScalarFieldsFromSnapshot(normalized);

  const wsId = normalized.workspaceId || '';
  if (!wsId) {
    wsSelect.value = '';
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
    if (dueDateInput) dueDateInput.value = normalized.due_date || '';
    await seedBranchDatalists([]);
    return;
  }

  wsSelect.value = wsId;
  await loadProjects(wsId);
  const available = Array.from(projectsDiv.querySelectorAll('input.project-radio')).map((el) => el.value);
  const pick = ProjectAutoRunLabel.pickSingleProjectId(normalized.projectIds || [], available);
  for (const el of projectsDiv.querySelectorAll('input.project-radio')) {
    el.checked = el.value === pick;
  }
  await loadWorkspaceCreateMeta(wsId);

  if (progressSelect && normalized.progress_column_id) {
    progressSelect.value = normalized.progress_column_id;
  }
  if (deliverableSelect && normalized.deliverable_obj_id) {
    deliverableSelect.value = normalized.deliverable_obj_id;
  }
  if (imageSelect) imageSelect.value = normalized.container_image_id || '';
  syncFloatAutoRun(normalized.auto_run);
  if (personalConfigSelect) {
    personalConfigSelect.value = normalized.personal_feature_params_config_id || '';
  }
  if (dueDateInput) dueDateInput.value = normalized.due_date || '';

  const assigneeSet = new Set(normalized.assigneeIds || []);
  if (assigneesDiv) {
    for (const cb of assigneesDiv.querySelectorAll('.taskplugin-assignee')) {
      cb.checked = assigneeSet.has(String(cb.value));
    }
  }

  if (repoBasesDiv && typeof CreateTaskPayload !== 'undefined') {
    repoBasesDiv.innerHTML = CreateTaskPayload.buildRepoBaseEditorsHtml({
      projectIds: pick ? [pick] : [],
      projectsList: projectsData,
      previousValues: normalized.repoBaseBranches || {},
      inputClass: 'taskplugin-input',
      emptyHint: CreateTaskPayload.REPO_BASE_EMPTY_HINT,
    });
    refreshFloatGitIdentities();
    populateFloatRepoBaseDatalists();
  }

  await fetchBranchesForFloatingPanel(wsId, pick ? [pick] : []);
  if (workBranch) workBranch.value = normalized.workBranch || '';
  if (mergeTarget) mergeTarget.value = normalized.mergeTarget || '';
}

