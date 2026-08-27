/**
 * Panel 项目单选列表与自动运行控件联动。
 * 依赖 window.PanelApp（panel-core.js / workspace.js）与 ProjectAutoRunLabel。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.autoRunFieldIds = function (containerId) {
    if (containerId === 'batchProjects') {
      return { inputId: 'batchAutoRun', hintId: 'batchAutoRunHint' };
    }
    return { inputId: 'singleAutoRun', hintId: 'singleAutoRunHint' };
  };

  P.imageFieldIds = function (containerId) {
    if (containerId === 'batchProjects') {
      return { selectId: 'batchContainerImage', markId: 'batchImageRequired' };
    }
    return { selectId: 'singleContainerImage', markId: 'singleImageRequired' };
  };

  P.projectsForContainer = function (containerId) {
    const selectId = containerId === 'batchProjects' ? 'batchWorkspace' : 'singleWorkspace';
    const wsId = P.$(`#${selectId}`)?.value;
    return (wsId && state.projectsCache[wsId]) || [];
  };

  P.syncContainerImageAppearance = function (containerId, project) {
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.resolveImageFieldAppearance !== 'function'
        || typeof ProjectAutoRunLabel.applyImageFieldAppearance !== 'function') {
      return;
    }
    const ids = P.imageFieldIds(containerId);
    const ap = ProjectAutoRunLabel.resolveImageFieldAppearance({
      projectAllowsAutoRun: ProjectAutoRunLabel.projectAllowsAutoRun(project),
    });
    ProjectAutoRunLabel.applyImageFieldAppearance(P.$(`#${ids.markId}`), P.$(`#${ids.selectId}`), ap);
  };

  P.syncContainerAutoRun = function (containerId, checkedPreference) {
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
      throw new Error('ProjectAutoRunLabel helpers missing');
    }
    const selectedId = P.getSelectedProjectIds(containerId)[0];
    const project = ProjectAutoRunLabel.findProjectById(P.projectsForContainer(containerId), selectedId);
    const imageIds = P.imageFieldIds(containerId);
    const hasImage = typeof ProjectAutoRunLabel.hasInstalledImageId === 'function'
      ? ProjectAutoRunLabel.hasInstalledImageId(P.$(`#${imageIds.selectId}`)?.value)
      : Boolean(String(P.$(`#${imageIds.selectId}`)?.value || '').trim());
    const pref = checkedPreference !== undefined
      ? Boolean(checkedPreference)
      : ProjectAutoRunLabel.projectAllowsAutoRun(project);
    const st = ProjectAutoRunLabel.resolveAutoRunControlState({
      selectedProject: project,
      checkedPreference: pref,
      hasInstalledImage: hasImage,
    });
    const ids = P.autoRunFieldIds(containerId);
    ProjectAutoRunLabel.applyAutoRunControlToElements(
      P.$(`#${ids.inputId}`),
      P.$(`#${ids.hintId}`),
      st,
    );
    P.syncContainerImageAppearance(containerId, project);
  };

  P.onContainerImageChange = function (containerId) {
    const ids = P.autoRunFieldIds(containerId);
    const input = P.$(`#${ids.inputId}`);
    const wasEnabled = Boolean(input && !input.disabled);
    P.syncContainerAutoRun(containerId, wasEnabled ? Boolean(input?.checked) : undefined);
    const wsSelectId = containerId === 'batchProjects' ? 'batchWorkspace' : 'singleWorkspace';
    const repoId = containerId === 'batchProjects' ? 'batchRepoBases' : 'singleRepoBases';
    const wsId = P.$(`#${wsSelectId}`)?.value;
    if (wsId) P.refreshRepoBaseEditors(repoId, containerId, wsId);
  };

  P.renderProjectCheckboxes = function (containerId, projects) {
    const c = P.$(`#${containerId}`);
    if (!projects.length) {
      c.innerHTML = '<p class="placeholder">该项目空间下暂无项目</p>';
      P.syncContainerAutoRun(containerId, false);
      return;
    }
    if (typeof ProjectAutoRunLabel === 'undefined'
        || typeof ProjectAutoRunLabel.renderProjectRadioHtml !== 'function'
        || typeof ProjectAutoRunLabel.resolveAutoRunControlState !== 'function') {
      throw new Error('ProjectAutoRunLabel helpers missing');
    }
    const radioName = containerId === 'batchProjects' ? 'batch-project' : 'single-project';
    let h = '';
    for (const p of projects) {
      h += ProjectAutoRunLabel.renderProjectRadioHtml(p, { name: radioName, esc: P.escHtml });
    }
    c.innerHTML = h;
  };

  P.restoreProjectSelection = async function (cid) {
    const ids = await Storage.getLastProjectIds();
    const radios = Array.from(P.$(`#${cid}`).querySelectorAll('.project-radio'));
    const pick = ProjectAutoRunLabel.pickSingleProjectId(ids, radios.map((r) => r.value));
    for (const r of radios) r.checked = r.value === pick;
    P.syncContainerAutoRun(cid);
  };

  P.getSelectedProjectIds = function (cid) {
    return Array.from(P.$(`#${cid}`).querySelectorAll('.project-radio:checked')).map((el) => el.value);
  };

  P.checkPanelAidevMatchingProjects = function (containerId, wsId) {
    if (!state.pendingAidevMatches?.length || typeof AidevMeta === 'undefined') return;
    const pids = AidevMeta.projectIdsForWorkspace(state.pendingAidevMatches, wsId);
    if (!pids.length) return;
    const c = P.$(`#${containerId}`);
    if (!c) return;
    const available = Array.from(c.querySelectorAll('.project-radio')).map((el) => el.value);
    const pick = ProjectAutoRunLabel.pickSingleProjectId(pids, available);
    for (const el of c.querySelectorAll('.project-radio')) {
      el.checked = el.value === pick;
    }
    P.syncContainerAutoRun(containerId);
  };
})();
