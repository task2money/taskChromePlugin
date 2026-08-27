/**
 * 页面-插件通信桥接层 (Page Bridge)
 *
 * 为 web 页面提供与 Chrome 插件通信的标准通道。
 * 页面通过 window.postMessage 发送请求，内容脚本中继到 Service Worker，
 * Service Worker 的响应再通过 postMessage 回传页面。
 *
 * ## 协议规范
 *
 * ### 页面 → 插件 (Page → Content Script)
 * ```js
 * window.postMessage({
 *   source: 'taskfe-account-bridge',  // 命名空间，防止与其他 postMessage 混淆
 *   action: 'getActiveToken',          // 操作名
 *   requestId: 'uuid-xxx',             // 唯一请求 ID，用于匹配响应
 *   payload: { ... }                   // 可选参数
 * }, window.location.origin)
 * ```
 *
 * ### 插件 → 页面 (Content Script → Page)
 * ```js
 * // 通过 window.postMessage 回传：
 * {
 *   source: 'taskfe-account-bridge',
 *   action: 'getActiveToken',
 *   requestId: 'uuid-xxx',   // 匹配原始请求
 *   success: true,
 *   data: 'tok_xxx',         // 成功时的响应数据
 *   error: null,             // 失败时的错误消息
 * }
 * ```
 *
 * ### 支持的操作 (SW message actions)
 *
 * | Action | Payload | Response | 说明 |
 * |--------|---------|----------|------|
 * | getSavedAccounts | - | AccountSlot[] | 获取所有已保存账号 |
 * | upsertSavedAccount | AccountSlot | { list, upserted, isNew } | 插入/更新账号 |
 * | removeSavedAccount | { userId } | { list, switchedTo } | 删除账号 |
 * | getActiveToken | - | string | 获取当前活跃 token |
 * | getActiveAccount | - | AccountSlot | 获取当前活跃账号 |
 * | getCurrentUserId | - | string | 获取当前活跃 userId |
 * | switchAccount | { userId } | AccountSlot | 切换活跃账号 |
 * | getAuthStatus | - | AuthStatus | 获取认证状态（兼容现有 SW action）|
 * | migrateFromLocalStorage | { accounts } | { migrated, count } | 迁移 localStorage 账号 |
 * | setActiveAccount | AccountSlot | { list, upserted, isNew } | 设置活跃账号（upsert + switch） |
 * | clearSavedAccounts | - | - | 清空所有账号 |
 *
 * ## 插件可用性检测
 *
 * 内容脚本加载后，会在 `window.__taskChromePlugin` 上设置标记。
 * 页面可检测 `window.__taskChromePlugin?.available` 判断插件是否已安装。
 */
(() => {
  try {
    if (window.__taskpluginPageBridge) return;
    window.__taskpluginPageBridge = true;
  } catch {
    return;
  }

  const NAMESPACE = 'taskfe-account-bridge';
  const RESPONSE_TIMEOUT_MS = 10000; // 10s 超时

  // ---- 标记插件可用性 ----

  function announceAvailability() {
    try {
      if (!window.__taskChromePlugin) {
        window.__taskChromePlugin = {};
      }
      window.__taskChromePlugin.available = true;
      window.__taskChromePlugin.version = '1.7.0';
    } catch {
      // 某些严格 CSP 页面可能阻止写入 window 属性
    }
  }

  // ---- 响应回传 ----

  function sendResponseToPage(requestId, action, result) {
    try {
      window.postMessage({
        source: NAMESPACE,
        action,
        requestId,
        success: result.success !== false,
        data: result.data !== undefined ? result.data : null,
        error: result.error || null,
      }, window.location.origin);
    } catch (e) {
      console.warn('[taskChromePlugin] postMessage 回传失败:', e.message);
    }
  }

  // ---- SW 通信 ----

  function sendToServiceWorker(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response || { success: false, error: 'SW returned empty response' });
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function relayToSW(action, payload) {
    const swMessage = { action };
    if (payload !== undefined) {
      Object.assign(swMessage, payload);
    }
    const result = await sendToServiceWorker(swMessage);
    return result;
  }

  // ---- postMessage 监听（单一 listener：ping + 业务中继）----

  function handlePing(msg) {
    try {
      window.postMessage({
        source: NAMESPACE,
        action: 'pong',
        requestId: msg.requestId,
        success: true,
        data: { version: '1.7.0', available: true },
      }, window.location.origin);
    } catch { /* ignore */ }
  }

  function handlePageMessage(event) {
    if (event.origin !== window.location.origin) return;
    if (event.source !== window) return;

    const msg = event.data;
    if (typeof shouldInspectPageBridgeMessage === 'function') {
      if (!shouldInspectPageBridgeMessage(msg, NAMESPACE)) return;
    } else if (!msg || typeof msg !== 'object' || msg.source !== NAMESPACE) {
      return;
    }

    const { action, requestId, payload } = msg;
    if (!action) return;
    if (action === 'ping') {
      handlePing(msg);
      return;
    }

    relayToSW(action, payload)
      .then((result) => {
        sendResponseToPage(requestId, action, result);
      })
      .catch((err) => {
        sendResponseToPage(requestId, action, {
          success: false,
          error: err.message || '插件通信失败',
        });
      });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) {
      return;
    }
    handlePageMessage(event);
  }, false);

  // ---- 初始化 ----

  announceAvailability();

  // ---- 监听 chrome.storage 变更并转发页面（不再跨 tab sendMessage）----
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes.savedAccounts && !changes.activeUserId && !changes.token && !changes.userId) {
        return;
      }
      try {
        window.postMessage({
          source: NAMESPACE,
          action: 'accountStateChanged',
          requestId: null,
          success: true,
          data: { event: 'authStateChanged' },
          error: null,
        }, window.location.origin);
      } catch (e) {
        // CSP 限制可能阻止 postMessage
      }
    });
  } catch (_) { /* ignore */ }

  console.log('[taskChromePlugin] Page bridge initialized (v1.7.0)');
})();
