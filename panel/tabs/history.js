/**
 * Panel Tab 4：历史记录 & 重试（OPT-20260812-051 拆分）。
 * 依赖 window.PanelApp（panel-core.js）。
 */
(function () {
  const P = window.PanelApp;
  const state = P.state;

  P.bindHistoryTab = function () {
    P.$('#btnRefreshHistory').addEventListener('click', P.refreshHistory);
    P.$('#btnClearHistory').addEventListener('click', async () => {
      await P.sendMessage({ action: 'clearTaskHistory' });
      await P.refreshHistory();
    });
    P.$('#btnRetryAllFailed').addEventListener('click', P.retryAllFailed);
  };

  P.refreshHistory = async function () {
    const c = P.$('#historyList');
    const statsEl = P.$('#historyStats');
    const retryBtn = P.$('#btnRetryAllFailed');

    try {
      const r = await P.sendMessage({ action: 'getTaskHistory' });
      if (!r.success || !r.data?.length) {
        c.innerHTML = '<p class="placeholder">暂无创建记录</p>';
        statsEl.innerHTML = '';
        retryBtn.style.display = 'none';
        return;
      }

      const history = [...r.data].reverse();
      const total = history.length;
      const success = history.filter((h) => h.status === 'success').length;
      const failed = history.filter((h) => h.status === 'failed').length;

      statsEl.innerHTML = `
        <span class="stat stat-total">总计: ${total}</span>
        <span class="stat stat-success">成功: ${success}</span>
        <span class="stat stat-failed">失败: ${failed}</span>`;
      retryBtn.style.display = failed > 0 ? '' : 'none';

      let h = '';
      for (const item of history) {
        const sc = item.status === 'success' ? 'success' : (item.status === 'failed' ? 'failed' : 'pending');
        const icon = item.type === 'batch' ? '📦' : '📋';
        const timeStr = new Date(item.createdAt).toLocaleString();
        const retries = item.retryCount ? `<span class="retry-badge">重试×${item.retryCount}</span>` : '';

        h += `<div class="history-item">
          <div class="hi-header">
            <span class="hi-title">${icon} ${P.escHtml(item.title)}${retries}</span>
            <span class="hi-status ${sc}">${item.status === 'success' ? '成功' : (item.status === 'failed' ? '失败' : '处理中')}</span>
          </div>
          <div class="hi-meta">
            <span>类型: ${item.type === 'batch' ? `批量(${item.count || '?'}个)` : '单个'}</span>
            <span>时间: ${timeStr}</span>
            ${item.resultId ? `<span>ID: ${item.resultId}</span>` : ''}
          </div>
          ${item.error ? `<div class="hi-error">${P.escHtml(item.error)}</div>` : ''}
          <div class="hi-actions">`;

        if (item.status === 'failed') {
          h += `<button class="btn btn-sm retry-single" data-id="${item.id}">🔁 重试</button>`;
        }
        h += `<button class="btn btn-sm copy-task" data-id="${item.id}">📋 复制数据</button>
          </div></div>`;
      }
      c.innerHTML = h;

      // 绑定重试按钮
      c.querySelectorAll('.retry-single').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await P.retrySingleTask(btn.dataset.id);
        });
      });
      // 绑定复制按钮
      c.querySelectorAll('.copy-task').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await P.copyTaskData(btn.dataset.id);
        });
      });
    } catch (_) { c.innerHTML = '<p class="placeholder">加载失败</p>'; }
  };

  P.retrySingleTask = async function (recordId) {
    const r = await P.sendMessage({ action: 'getTaskHistory' });
    if (!r.success) return;
    const record = r.data.find((h) => h.id === recordId);
    if (!record || !record.taskData) return P.showR('historyResult', 'error', '无法找到任务数据');

    const btn = document.querySelector(`.retry-single[data-id="${recordId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '重试中...'; }

    try {
      const mapping = await P.sendMessage({ action: 'getEndpointMapping' });
      if (record.type === 'batch') {
        const res = await P.sendMessage({
          action: 'createTasksBatch', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
          endpointMapping: mapping.success ? mapping.data : undefined,
          tasksData: record.tasksData || record.taskData,
        });
        if (!res.success) {
          const err = new Error(res.error);
          const tid = extractTraceId(res);
          if (tid) err.traceId = tid;
          throw err;
        }
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      } else {
        const res = await P.sendMessage({
          action: 'createTask', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
          endpointMapping: mapping.success ? mapping.data : undefined,
          taskData: record.taskData,
        });
        if (!res.success) {
          const err = new Error(res.error);
          const tid = extractTraceId(res);
          if (tid) err.traceId = tid;
          throw err;
        }
        await Storage.updateTaskHistory(recordId, { status: 'success', response: res.data, retryCount: (record.retryCount || 0) + 1, error: null });
      }
      P.showR('historyResult', 'success', '✅ 重试成功!');
      await P.refreshHistory();
    } catch (e) {
      await Storage.updateTaskHistory(recordId, { status: 'failed', error: e.message, retryCount: (record.retryCount || 0) + 1 });
      P.showR('historyResult', 'error', `❌ 重试失败: ${e.message}`, e.traceId);
      await P.refreshHistory();
    }
    if (btn) { btn.disabled = false; btn.textContent = '🔁 重试'; }
  };

  P.retryAllFailed = async function () {
    const r = await P.sendMessage({ action: 'getFailedTasks' });
    if (!r.success || !r.data?.length) return P.showR('historyResult', 'error', '没有失败的任务');

    const btn = P.$('#btnRetryAllFailed');
    btn.disabled = true;
    const failed = r.data;
    btn.textContent = `重试中 (0/${failed.length})...`;

    let ok = 0, fail = 0;
    for (let i = 0; i < failed.length; i++) {
      btn.textContent = `重试中 (${i + 1}/${failed.length})...`;
      const record = failed[i];
      try {
        const mapping = await P.sendMessage({ action: 'getEndpointMapping' });
        if (record.type === 'batch') {
          const res = await P.sendMessage({
            action: 'createTasksBatch', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
            endpointMapping: mapping.success ? mapping.data : undefined,
            tasksData: record.tasksData || record.taskData,
          });
          if (!res.success) throw new Error(res.error);
        } else {
          const res = await P.sendMessage({
            action: 'createTask', baseUrl: state.apiConfig.baseUrl, token: state.apiConfig.token,
            endpointMapping: mapping.success ? mapping.data : undefined,
            taskData: record.taskData,
          });
          if (!res.success) throw new Error(res.error);
        }
        await Storage.updateTaskHistory(record.id, { status: 'success', retryCount: (record.retryCount || 0) + 1, error: null });
        ok++;
      } catch (e) {
        await Storage.updateTaskHistory(record.id, { status: 'failed', error: e.message, retryCount: (record.retryCount || 0) + 1 });
        fail++;
      }
    }
    btn.disabled = false; btn.textContent = '🔁 重试全部失败';
    P.showR('historyResult', 'success', `✅ 重试完成: ${ok} 成功, ${fail} 失败`);
    await P.refreshHistory();
  };

  P.copyTaskData = async function (recordId) {
    const r = await P.sendMessage({ action: 'getTaskHistory' });
    if (!r.success) return;
    const record = r.data.find((h) => h.id === recordId);
    if (!record?.taskData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(record.taskData, null, 2));
      P.showR('historyResult', 'success', '📋 任务数据已复制到剪贴板');
    } catch (_) {
      P.showR('historyResult', 'error', '复制失败');
    }
  };
})();
