/** Popup：Alt+E 默认工作空间 / 项目选择（依赖 Storage + sendMessageWithTimeout）。 */
(function () {
  const $ = (sel) => document.querySelector(sel);

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setDefaultsSectionVisible(visible) {
    const sec = $('#pageAdvisorDefaultsSection');
    if (sec) sec.style.display = visible ? 'block' : 'none';
  }

  let workspacesCache = [];
  let loadingProjects = false;

  async function loadPageAdvisorDefaults() {
    const wsSel = $('#popupDefaultWorkspace');
    const projHost = $('#popupDefaultProjects');
    const status = $('#popupDefaultsStatus');
    if (!wsSel || !projHost) return;

    setDefaultsSectionVisible(true);
    wsSel.innerHTML = '<option value="">加载中...</option>';
    projHost.innerHTML = '<span class="hint">加载工作空间中…</span>';
    if (status) status.textContent = '';

    try {
      const r = await sendMessageWithTimeout({ action: 'getWorkspaces' }, 12000);
      if (!r?.success) throw new Error(r?.error || '加载工作空间失败');
      const data = r.data;
      workspacesCache = Array.isArray(data) ? data : (data?.results || data?.items || data?.data || []);
      if (!workspacesCache.length) {
        wsSel.innerHTML = '<option value="">(无工作空间)</option>';
        projHost.innerHTML = '<span class="hint">暂无工作空间</span>';
        return;
      }

      const labels = (typeof WorkspaceList !== 'undefined' && WorkspaceList.workspaceOptionLabels)
        ? WorkspaceList.workspaceOptionLabels(workspacesCache)
        : workspacesCache.map((w) => w.name || w.id || w._id);

      const lastWs = await Storage.getLastWorkspace();
      let html = '<option value="">-- 选择工作空间 --</option>';
      for (let i = 0; i < workspacesCache.length; i++) {
        const id = String(workspacesCache[i].id || workspacesCache[i]._id || '');
        html += `<option value="${esc(id)}">${esc(labels[i])}</option>`;
      }
      wsSel.innerHTML = html;
      if (lastWs && workspacesCache.some((w) => String(w.id || w._id) === String(lastWs))) {
        wsSel.value = String(lastWs);
        await loadPopupProjects(String(lastWs));
      } else {
        projHost.innerHTML = '<span class="hint">请先选择工作空间</span>';
      }
    } catch (e) {
      console.warn('[TaskPlugin] loadPageAdvisorDefaults:', e.message || e);
      wsSel.innerHTML = '<option value="">加载失败</option>';
      projHost.innerHTML = `<span class="hint err">${esc(e.message || '加载失败')}</span>`;
      if (typeof setDataTraceId === 'function') setDataTraceId(projHost, e);
    }
  }

  async function loadPopupProjects(wsId) {
    const projHost = $('#popupDefaultProjects');
    if (!projHost) return;
    if (!wsId) {
      projHost.innerHTML = '<span class="hint">请先选择工作空间</span>';
      return;
    }
    if (loadingProjects) return;
    loadingProjects = true;
    projHost.innerHTML = '<span class="hint">加载项目中…</span>';
    try {
      const ws = workspacesCache.find((w) => String(w.id || w._id) === String(wsId));
      const companyId = ws?.company_id || ws?.companyId || '';
      const r = await sendMessageWithTimeout({
        action: 'getProjects',
        workspaceId: wsId,
        companyId,
      }, 12000);
      if (!r?.success) throw new Error(r?.error || '加载项目失败');
      const data = r.data;
      const projectsCache = Array.isArray(data) ? data : (data?.items || data?.data || []);
      if (!projectsCache.length) {
        projHost.innerHTML = '<span class="hint">无项目</span>';
        await Storage.saveLastProjectIds([]);
        return;
      }

      const lastIds = await Storage.getLastProjectIds();
      const pick = (typeof PageAdvisorDefaults !== 'undefined'
        && PageAdvisorDefaults.resolveDefaultProjectId)
        ? PageAdvisorDefaults.resolveDefaultProjectId(lastIds, projectsCache)
        : (lastIds[0] || '');

      let html = '';
      for (const p of projectsCache) {
        if (typeof ProjectAutoRunLabel !== 'undefined' && ProjectAutoRunLabel.renderProjectRadioHtml) {
          html += ProjectAutoRunLabel.renderProjectRadioHtml(p, {
            name: 'popup-default-project',
            esc,
          });
        } else {
          const id = String(p.id || p._id || '');
          const name = p.name || id;
          html += `<label><input type="radio" name="popup-default-project" value="${esc(id)}" class="project-radio"> ${esc(name)}</label>`;
        }
      }
      projHost.innerHTML = html;
      const radios = projHost.querySelectorAll('input.project-radio');
      let matched = false;
      for (const el of radios) {
        if (pick && el.value === pick) {
          el.checked = true;
          matched = true;
        }
      }
      if (!matched && radios[0]) radios[0].checked = true;
      const checked = Array.from(radios).filter((el) => el.checked).map((el) => el.value);
      await Storage.saveLastProjectIds(checked);
    } catch (e) {
      console.warn('[TaskPlugin] loadPopupProjects:', e.message || e);
      projHost.innerHTML = `<span class="hint err">${esc(e.message || '加载失败')}</span>`;
      if (typeof setDataTraceId === 'function') setDataTraceId(projHost, e);
    } finally {
      loadingProjects = false;
    }
  }

  function bindPageAdvisorDefaultsEvents() {
    const wsSel = $('#popupDefaultWorkspace');
    const projHost = $('#popupDefaultProjects');
    if (!wsSel || wsSel.dataset.bound === '1') return;
    wsSel.dataset.bound = '1';

    // Anti-Replay-OK: ui-only storage write（无 HTTP 写接口）
    wsSel.addEventListener('change', async () => {
      const wsId = wsSel.value;
      const status = $('#popupDefaultsStatus');
      try {
        await Storage.saveLastWorkspace(wsId || null);
        if (!wsId) {
          await Storage.saveLastProjectIds([]);
          if (projHost) projHost.innerHTML = '<span class="hint">请先选择工作空间</span>';
          if (status) status.textContent = '已清除默认工作空间';
          return;
        }
        await loadPopupProjects(wsId);
        if (status) status.textContent = '已保存默认工作空间';
      } catch (e) {
        if (status) status.textContent = e.message || '保存失败';
      }
    });

    if (projHost && projHost.dataset.bound !== '1') {
      projHost.dataset.bound = '1';
      // Anti-Replay-OK: ui-only storage write
      projHost.addEventListener('change', async (e) => {
        if (e.target?.type !== 'radio' || !e.target.classList.contains('project-radio')) return;
        const checked = Array.from(projHost.querySelectorAll('input.project-radio:checked'))
          .map((el) => el.value);
        const status = $('#popupDefaultsStatus');
        try {
          await Storage.saveLastProjectIds(checked);
          if (status) status.textContent = '已保存默认项目';
        } catch (err) {
          if (status) status.textContent = err.message || '保存失败';
        }
      });
    }
  }

  window.PopupPageAdvisorDefaults = {
    loadPageAdvisorDefaults,
    setDefaultsSectionVisible,
    bindPageAdvisorDefaultsEvents,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPageAdvisorDefaultsEvents);
  } else {
    bindPageAdvisorDefaultsEvents();
  }
})();
