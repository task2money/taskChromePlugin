/**
 * DevTools Panel 请求列表启动引导（纯逻辑，无 Chrome API）
 *
 * 解决两类卡死：
 * 1. onShown 的 initRequests 在 Panel.init await 期间先到达 → 消息丢失
 * 2. SW 兜底为空时不刷新 UI → 永久停在「正在加载请求列表...」
 */

const REQUEST_MESSAGE_ACTIONS = new Set(['initRequests', 'newRequest', 'requestUpdated']);

function isRequestListMessage(data) {
  return !!(data && REQUEST_MESSAGE_ACTIONS.has(data.action));
}

/**
 * 缓冲早到的请求列表消息，直到 consumer 就绪再一次性排空。
 * @returns {{
 *   push: (data: object) => boolean,
 *   setConsumer: (fn: (data: object) => void) => number,
 *   pendingCount: number,
 *   ready: boolean,
 * }}
 */
function createRequestMessageBuffer() {
  const pending = [];
  let ready = false;
  let consumer = null;

  function push(data) {
    if (!isRequestListMessage(data)) return false;
    if (ready && typeof consumer === 'function') {
      consumer(data);
      return true;
    }
    pending.push(data);
    return true;
  }

  function setConsumer(fn) {
    if (typeof fn !== 'function') {
      throw new Error('setConsumer requires a function');
    }
    consumer = fn;
    ready = true;
    const drained = pending.splice(0, pending.length);
    for (const data of drained) fn(data);
    return drained.length;
  }

  return {
    push,
    setConsumer,
    get pendingCount() {
      return pending.length;
    },
    get ready() {
      return ready;
    },
  };
}

/**
 * SW 兜底合并：本地已有数据则保留；否则采用 SW 非空列表。
 * @param {object[]} recent
 * @param {{ success?: boolean, data?: object[] }|null|undefined} swResponse
 * @returns {object[]}
 */
function mergeFallbackRecentRequests(recent, swResponse) {
  const local = Array.isArray(recent) ? recent : [];
  if (local.length > 0) return local;
  if (swResponse?.success && Array.isArray(swResponse.data) && swResponse.data.length > 0) {
    return swResponse.data;
  }
  return local;
}

/**
 * 兜底结束后是否必须刷新列表 UI（含空列表，用于清除 loading 占位）。
 * 始终为 true —— 空列表也要离开「正在加载」。
 */
function mustRefreshRequestListUiAfterFallback() {
  return true;
}

/**
 * 请求列表容器应展示的占位语义。
 * @param {{ count: number, bootstrapped: boolean }} state
 * @returns {'loading'|'empty'|'list'}
 */
function resolveRequestListPlaceholder(state) {
  const count = Number(state?.count) || 0;
  if (count > 0) return 'list';
  if (state?.bootstrapped) return 'empty';
  return 'loading';
}

const PanelRequestBootstrap = {
  REQUEST_MESSAGE_ACTIONS,
  isRequestListMessage,
  createRequestMessageBuffer,
  mergeFallbackRecentRequests,
  mustRefreshRequestListUiAfterFallback,
  resolveRequestListPlaceholder,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PanelRequestBootstrap;
}
