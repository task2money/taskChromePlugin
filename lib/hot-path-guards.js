/**
 * CPU 热路径守卫（content / page-bridge / SW 共用纯函数）
 *
 * 插件注入 <all_urls>：闲置时不得把 mousemove、全量 postMessage、GET body
 * 捕获、隐藏页 interval 留在热路径上，否则标签页变多后 CPU 随时间上涨。
 */

function shouldRunPeriodicAuthTick(state) {
  if (!state) return false;
  if (state.hidden) return false;
  if (state.inFlight) return false;
  return true;
}

function shouldCacheWebRequestBody(details, captureEnabled) {
  if (!captureEnabled) return false;
  if (!details || details.tabId < 0) return false;
  const method = String(details.method || '').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false;
  return true;
}

function shouldInspectPageBridgeMessage(data, namespace) {
  return !!(data && typeof data === 'object' && data.source === namespace);
}

/**
 * page-bridge 已转发 token / userId / savedAccounts / activeUserId。
 * content 只对 page-bridge 未覆盖的键补发，避免双重 window.postMessage。
 */
function shouldNotifyPageAccountStateFromContent(changes) {
  if (!changes) return false;
  if (changes.token || changes.userId || changes.savedAccounts || changes.activeUserId) {
    return false;
  }
  return !!(changes.tokenExpiresAt || changes.baseUrl || changes.memberId);
}

/** onBeforeRequest extraInfoSpec:requestBody 的 types 过滤：跳过静态资源 */
const WEB_REQUEST_BODY_TYPES = ['xmlhttprequest', 'main_frame', 'sub_frame', 'other'];

const HotPathGuards = {
  shouldRunPeriodicAuthTick,
  shouldCacheWebRequestBody,
  shouldInspectPageBridgeMessage,
  shouldNotifyPageAccountStateFromContent,
  WEB_REQUEST_BODY_TYPES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HotPathGuards;
}
if (typeof globalThis !== 'undefined') {
  globalThis.HotPathGuards = HotPathGuards;
  globalThis.shouldRunPeriodicAuthTick = shouldRunPeriodicAuthTick;
  globalThis.shouldCacheWebRequestBody = shouldCacheWebRequestBody;
  globalThis.shouldInspectPageBridgeMessage = shouldInspectPageBridgeMessage;
  globalThis.shouldNotifyPageAccountStateFromContent = shouldNotifyPageAccountStateFromContent;
  globalThis.WEB_REQUEST_BODY_TYPES = WEB_REQUEST_BODY_TYPES;
}
