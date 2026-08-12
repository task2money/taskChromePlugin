/**
 * DevTools Panel 主入口（orchestrator，OPT-20260812-051 拆分）。
 * Tab 1: 单请求创建任务 (含搜索/过滤) → tabs/single-request.js
 * Tab 2: 批量错误捕获 & 创建 → tabs/batch.js
 * Tab 3: 错误列表查看 → tabs/errors.js
 * Tab 4: 历史记录 & 重试 → tabs/history.js
 * Tab 5: 使用说明 → lib/user-guide.js
 *
 * 共享状态/工具/认证 → lib/panel-core.js（window.PanelApp）
 * 工作空间/项目/成员加载 → lib/workspace.js
 * 分支模板/datalist → lib/branches.js
 *
 * 脚本加载顺序见 panel.html（panel-core → workspace → branches → tabs → panel.js）。
 */
const Panel = (() => {
  const P = window.PanelApp;

  // ---- Tabs ----
  function bindTabs() {
    P.$$('.tab').forEach((t) => {
      t.addEventListener('click', () => {
        P.$$('.tab').forEach((x) => x.classList.remove('active'));
        P.$$('.tab-content').forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        const c = P.$(`#tab-${t.dataset.tab}`);
        if (c) c.classList.add('active');
        if (t.dataset.tab === 'single') P.refreshRequestList();
        if (t.dataset.tab === 'batch') P.refreshCapturedCount();
        if (t.dataset.tab === 'errors') P.refreshErrorList();
        if (t.dataset.tab === 'history') P.refreshHistory();
      });
    });
  }

  // ---- Init ----
  async function init() {
    // 先挂请求列表管道，再做任何 await（修复卡在「正在加载请求列表...」）
    P.bindRequestMessagePipeline();
    P.mountUserGuide();

    await P.refreshAuthState();
    await P.loadSavedOwner();
    bindTabs();
    P.bindAuthListener();
    P.bindSingleTab();
    P.bindBatchTab();
    P.bindErrorListTab();
    P.bindHistoryTab();
    P.initBranchDatalistPresets();
    // 立即加载工作空间（不等待用户点击请求）
    P.loadWorkspaces('singleWorkspace');
    await P.checkConnection();
    P.startAuthBadgeTimer();
    // 数据由 postMessage 推送；若 1.5s 内未收到则从 SW 兜底（空列表也必须刷新 UI）
    setTimeout(async () => {
      if (P.state.recentRequests.length === 0) {
        try {
          const res = await P.sendMessage({ action: 'getRecentRequests', filter: {}, limit: 200 });
          const merged = P.Bootstrap
            ? P.Bootstrap.mergeFallbackRecentRequests(P.state.recentRequests, res)
            : ((res?.success && res.data?.length > 0) ? res.data : P.state.recentRequests);
          P.state.recentRequests = merged;
          if (P.state.recentRequests.length > 0) {
            P.state.recentRequests.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          }
        } catch (_) { /* ignore */ }
      }
      if (!P.Bootstrap || P.Bootstrap.mustRefreshRequestListUiAfterFallback()) {
        P.applyRequestFilters();
      }
    }, 1500);
    P.setRequestLoading(false);
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Panel.init());
