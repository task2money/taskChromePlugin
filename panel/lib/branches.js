/**
 * Panel 分支模板/datalist 工具（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  // ---- Merge Target Branch Helpers ----

  const WORK_BRANCH_PRESET_OPTIONS = [
    { value: 'feature', label: 'feature/${日期}_aidev${taskId}_${标题}' },
    { value: 'bugfix', label: 'bugfix/${日期}_aidev${taskId}_${标题}' },
    { value: 'hotfix', label: 'hotfix/${日期}_aidev${taskId}_${标题}' },
    { value: 'release', label: 'release/${日期}_aidev${taskId}' },
  ];

  const WORK_BRANCH_LABEL_TO_PRESET = Object.fromEntries(
    WORK_BRANCH_PRESET_OPTIONS.map((p) => [p.label, p.value]),
  );

  /** 计算接下来第 N 个周四的 YYYYMMDD 日期（N=0 为最近的下一个周四，含今天） */
  function getThursdayYmd(weekOffset = 0) {
    const d = new Date();
    const dayOfWeek = d.getDay(); // 0=Sun ... 4=Thu ... 6=Sat
    const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    d.setDate(d.getDate() + daysUntilThursday + weekOffset * 7);
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  /** 计算接下来 N 个周四，返回 [{value, label, dateYmd}]，标签根据今天是否已过本周四自动调整 */
  function getNextThursdays(count = 3) {
    const result = [];
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun ... 4=Thu ... 6=Sat
    // 若今天已过周四（周五/周六），则从下周开始；否则从本周开始
    const startWeek = dayOfWeek > 4 ? 1 : 0;
    const labels = dayOfWeek > 4
      ? ['下周四', '下下周四', '下下下周四']
      : ['本周四', '下周四', '下下周四'];
    for (let i = 0; i < count; i++) {
      const ymd = getThursdayYmd(startWeek + i);
      result.push({
        value: `release:${startWeek + i}`,
        label: `release / ${ymd} (${labels[i] || `第${startWeek + i + 1}个周四`})`,
        dateYmd: ymd,
      });
    }
    return result;
  }

  /** 合并目标分支模板选项（含动态 release 周四） */
  function getMergeTargetPresetOptions() {
    const thursdays = getNextThursdays(3);
    return [
      { value: 'develop', label: 'develop' },
      ...thursdays.map((t) => ({ value: t.value, label: t.label })),
      { value: 'main', label: 'main' },
    ];
  }

  function getMergeTargetLabelToPreset() {
    return Object.fromEntries(getMergeTargetPresetOptions().map((p) => [p.label, p.value]));
  }

  /** 向 datalist 追加模板选项（置于 Git 分支之前） */
  function appendPresetOptionsToDatalist(datalist, presetKind) {
    if (!datalist) return;
    const presets = presetKind === 'work' ? WORK_BRANCH_PRESET_OPTIONS : getMergeTargetPresetOptions();
    for (const p of presets) {
      datalist.innerHTML += `<option value="${P.escHtml(p.label)}">[模板] ${P.escHtml(p.label)}</option>`;
    }
  }

  P.initBranchDatalistPresets = function () {
    appendPresetOptionsToDatalist(P.$('#singleWorkBranchList'), 'work');
    appendPresetOptionsToDatalist(P.$('#singleMergeTargetList'), 'merge');
    appendPresetOptionsToDatalist(P.$('#batchWorkBranchList'), 'work');
    appendPresetOptionsToDatalist(P.$('#batchMergeTargetList'), 'merge');
  };

  function buildMergeTargetBranchName(presetType) {
    // 处理 release:N 格式
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

  P.handleBranchInputChange = function (inputId, presetKind, titleSourceId) {
    const input = P.$(`#${inputId}`);
    if (!input) return;
    const labelMap = presetKind === 'work' ? WORK_BRANCH_LABEL_TO_PRESET : getMergeTargetLabelToPreset();
    const presetKey = labelMap[input.value];
    if (!presetKey) return;
    const branchName = presetKind === 'work'
      ? buildWorkBranchName(presetKey, titleSourceId)
      : buildMergeTargetBranchName(presetKey);
    if (branchName) input.value = branchName;
  };

  function buildWorkBranchName(presetType, titleSourceId) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const titleEl = titleSourceId ? P.$(`#${titleSourceId}`) : null;
    const titleSlug = (titleEl?.value || 'task')
      .replace(/[^\w一-龥]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'task';
    if (presetType === 'release') {
      return `release/${today}_aidev\${taskId}`;
    }
    if (presetType === 'feature' || presetType === 'bugfix' || presetType === 'hotfix') {
      return `${presetType}/${today}_aidev\${taskId}_${titleSlug}`;
    }
    return '';
  }

  P.fetchSingleBranchLists = async function (wsId, projectIds) {
    await P.fetchAndPopulateBranches('singleWorkBranchList', wsId, projectIds, 'work');
    await P.fetchAndPopulateBranches('singleMergeTargetList', wsId, projectIds, 'merge');
  };

  P.fetchBatchBranchLists = async function (wsId, projectIds) {
    await P.fetchAndPopulateBranches('batchWorkBranchList', wsId, projectIds, 'work');
    await P.fetchAndPopulateBranches('batchMergeTargetList', wsId, projectIds, 'merge');
  };

  /**
   * 选定项目后把远程分支填进基准分支 datalist（内置 develop/main 已在 HTML 中）。
   * 对齐工作面板 CreateTaskProjectBranchSection 的 per-repo datalist；
   * 共用 BranchDatalist.populateRepoBaseBranchDatalists（OPT-20260828-016）。
   */
  P.populateRepoBaseBranchDatalists = async function (containerEl, wsId) {
    if (!containerEl || !wsId) return;
    if (typeof BranchDatalist === 'undefined'
        || typeof BranchDatalist.populateRepoBaseBranchDatalists !== 'function') {
      return;
    }
    const ws = state.workspaces.find((w) => String(w.id || w._id) === String(wsId));
    if (!ws?.company_id && !ws?.companyId) return;
    await BranchDatalist.populateRepoBaseBranchDatalists({
      containerEl,
      projects: state.projectsCache[wsId] || [],
      workspace: ws,
      ensureApiReady: () => P.ensureApiReady(),
      getBranches: (params) => P.swApi('getBranches', params),
      logPrefix: '[taskChromePlugin] repo-base getBranches failed',
    });
  };

  /**
   * 从选中的项目获取 Git 分支列表，填充到 datalist 中
   * @param {string} datalistId - datalist 元素 ID
   * @param {string} wsId - 工作空间 ID
   * @param {string[]} projectIds - 选中的项目 ID 列表
   */
  P.fetchAndPopulateBranches = async function (datalistId, wsId, projectIds, presetKind) {
    const datalist = P.$(`#${datalistId}`);
    if (!datalist) return;
    datalist.innerHTML = '';
    if (presetKind) appendPresetOptionsToDatalist(datalist, presetKind);

    if (!wsId || !projectIds.length) return;
    if (!(await P.ensureApiReady())) return;

    const cached = state.projectsCache[wsId] || [];
    const ws = state.workspaces.find(w => (w.id || w._id) === wsId);
    const companyId = ws?.company_id || ws?.companyId;
    if (!companyId) return;

    const seen = new Set();
    // 内置预设分支始终显示
    const builtin = ['develop', 'main'];
    for (const b of builtin) {
      if (!seen.has(b)) {
        seen.add(b);
        datalist.innerHTML += `<option value="${b}">${b}  [内置]</option>`;
      }
    }

    // 从每个选中项目获取远程分支（限制最多 3 个项目避免请求过多）
    const toFetch = projectIds.slice(0, 3);
    for (const pid of toFetch) {
      const proj = cached.find(p => String(p.id || p._id) === String(pid));
      const repos = Array.isArray(proj?.git_repos) ? proj.git_repos.filter(u => u && String(u).trim()) : [];
      const repoUrl = repos[0];
      if (!repoUrl) continue;

      const shortRepo = extractRepoLabel(repoUrl);
      try {
        const resp = await P.swApi('getBranches', {
          companyId: String(companyId),
          projectId: pid,
          repoUrl,
        });
        const branches = Array.isArray(resp?.branches) ? resp.branches : (Array.isArray(resp) ? resp : []);
        for (const b of branches) {
          const name = typeof b === 'string' ? b : (b.name || b.branch_name || '');
          if (!name) continue;
          if (!seen.has(name)) {
            seen.add(name);
            const label = shortRepo ? `${P.escHtml(name)}  [${P.escHtml(shortRepo)}]` : P.escHtml(name);
            datalist.innerHTML += `<option value="${P.escHtml(name)}">${label}</option>`;
          }
        }
      } catch (_) {
        // 分支获取失败不影响主流程
      }
    }
  };

  /** 从 Git repo URL 提取简短标识（如 gitlab:owner/repo） */
  function extractRepoLabel(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\.git$/, '').replace(/^\//, '');
      const parts = path.split('/');
      if (parts.length >= 2) return parts.slice(-2).join('/');
      return u.hostname;
    } catch (_) { return ''; }
  }
})();
