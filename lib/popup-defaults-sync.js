/**
 * OPT-20260914-006: Popup「Alt+E 默认上下文」与浮窗选择的双向实时同步。
 *
 * 1.8.29 起 popup 与浮窗共用 `lastWorkspaceId` / `lastProjectIds`；但 popup 打开期间
 * 在浮窗改选，popup 需关掉重开才看到新值。本模块监听 `chrome.storage.onChanged`
 * 让 popup 即时跟随。
 *
 * 关键契约（防写回环）：处理器**只读** storage 并重渲染，绝不回写。popup 自身的
 * 交互写路径（saveLastWorkspace / saveLastProjectIds）也会触发 onChanged，若处理器
 * 回写即形成 popup↔storage 死循环。故本模块不持有任何写 IO。
 *
 * 所有 IO/渲染经 deps 注入，便于单测直接驱动 handle()。
 */
(function () {
  /** 共用默认上下文的 storage key（chrome.storage.local）。 */
  const DEFAULTS_STORAGE_KEYS = ['lastWorkspaceId', 'lastProjectIds'];

  /** changes 是否触及默认上下文键。 */
  function defaultsKeysChanged(changes) {
    if (!changes || typeof changes !== 'object') return false;
    return DEFAULTS_STORAGE_KEYS.some((k) =>
      Object.prototype.hasOwnProperty.call(changes, k));
  }

  /**
   * 创建 onChanged 处理器。
   * deps:
   *   getLastWorkspace()  -> Promise<string|null>
   *   getLastProjectIds() -> Promise<string[]>
   *   getWorkspaces()     -> Array   已缓存的工作空间（空表示尚未加载完成）
   *   getCurrentWorkspace()-> string  popup select 当前值
   *   setCurrentWorkspace(id)         仅改 UI，不写 storage
   *   loadProjects(wsId)  -> Promise  以 persist:false 重新渲染项目单选
   *   applyProjects(ids)              仅改 UI，不写 storage
   *   setStatus(text)                 状态提示
   *   warn(err)                       诊断日志
   */
  function createDefaultsStorageSync(deps) {
    const d = deps || {};
    const warn = typeof d.warn === 'function' ? d.warn : () => {};
    let syncing = false;

    async function handle(changes) {
      if (syncing) return;
      if (!defaultsKeysChanged(changes)) return;
      // 工作空间尚未加载完成（下拉为空）时不干预：初次 loadPageAdvisorDefaults
      // 本就会读取最新 storage 值。
      if (!d.getWorkspaces || d.getWorkspaces().length === 0) return;

      const changedWs = Object.prototype.hasOwnProperty.call(changes, 'lastWorkspaceId');
      const changedIds = Object.prototype.hasOwnProperty.call(changes, 'lastProjectIds');

      syncing = true;
      try {
        const lastWs = await d.getLastWorkspace();
        const wsId = lastWs ? String(lastWs) : '';
        if (changedWs && wsId !== String(d.getCurrentWorkspace() ?? '')) {
          d.setCurrentWorkspace(wsId);
          if (!wsId) {
            d.setStatus(tx('popupDefaultsSynced'));
            return;
          }
          await d.loadProjects(wsId);
          d.setStatus(tx('popupDefaultsSynced'));
          return;
        }
        if (changedIds) {
          if (!wsId) return;
          await d.applyProjects(await d.getLastProjectIds());
          d.setStatus(tx('popupDefaultsSynced'));
        }
      } catch (e) {
        warn(e);
      } finally {
        syncing = false;
      }
    }

    /** 订阅 chrome.storage.onChanged；仅处理 local 区。返回是否订阅成功。 */
    function register(chromeApi) {
      const onChanged = chromeApi && chromeApi.storage && chromeApi.storage.onChanged;
      if (!onChanged || typeof onChanged.addListener !== 'function') return false;
      onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        handle(changes);
      });
      return true;
    }

    return { handle, register };
  }

  const PopupDefaultsSync = {
    DEFAULTS_STORAGE_KEYS,
    defaultsKeysChanged,
    createDefaultsStorageSync,
  };

  if (typeof window !== 'undefined') window.PopupDefaultsSync = PopupDefaultsSync;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PopupDefaultsSync;
  }
})();
