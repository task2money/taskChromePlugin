/**
 * CPU 热路径守卫（content / SW 共用纯函数）
 *
 * 插件注入 <all_urls>：闲置时不得把 mousemove、GET body
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

/** onBeforeRequest extraInfoSpec:requestBody 的 types 过滤：跳过静态资源 */
const WEB_REQUEST_BODY_TYPES = ['xmlhttprequest', 'main_frame', 'sub_frame', 'other'];

const HotPathGuards = {
  shouldRunPeriodicAuthTick,
  shouldCacheWebRequestBody,
  WEB_REQUEST_BODY_TYPES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HotPathGuards;
}
if (typeof globalThis !== 'undefined') {
  globalThis.HotPathGuards = HotPathGuards;
  globalThis.shouldRunPeriodicAuthTick = shouldRunPeriodicAuthTick;
  globalThis.shouldCacheWebRequestBody = shouldCacheWebRequestBody;
  globalThis.WEB_REQUEST_BODY_TYPES = WEB_REQUEST_BODY_TYPES;
}
