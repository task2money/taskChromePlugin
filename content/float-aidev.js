/**
 * 浮窗 aidev 元信息反查与自动选中（依赖 float-boot / float-form 全局）。
 */
function setAidevStatus(text, visible = true) {
  if (!aidevStatusEl) return;
  if (!visible || !text) {
    aidevStatusEl.hidden = true;
    aidevStatusEl.textContent = '';
    aidevStatusEl.removeAttribute('role');
    aidevStatusEl.setAttribute('aria-live', 'polite');
    return;
  }
  aidevStatusEl.textContent = text;
  aidevStatusEl.hidden = false;
  // Mismatch / failure: assertive alert. Success match: polite status.
  const alertPattern = typeof tx === 'function' ? tx('commonAlertKeywords') : '未匹配|失败|错误';
  const isAlert = new RegExp(alertPattern).test(text);
  aidevStatusEl.setAttribute('role', isAlert ? 'alert' : 'status');
  aidevStatusEl.setAttribute('aria-live', isAlert ? 'assertive' : 'polite');
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
    setAidevStatus(typeof tx === 'function' ? tx('commonMetaLookupFailed', { msg: e.message }) : `元信息反查失败: ${e.message}`);
  }
}
