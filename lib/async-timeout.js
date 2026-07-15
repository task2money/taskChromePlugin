/**
 * Promise 超时包装 — Popup / Panel 启动路径防卡死
 */

function withTimeout(promise, ms, label = '操作') {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(promise);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}超时(${timeoutMs}ms)`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 启动看门狗：超时后强制执行 onTimeout（用于隐藏 spinner）。
 * 返回 cancel()，在正常完成时调用。
 */
function startWatchdog(ms, onTimeout) {
  const timeoutMs = Number(ms);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { cancel() {} };
  }
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    try {
      onTimeout();
    } catch (_) { /* ignore */ }
  }, timeoutMs);
  return {
    cancel() {
      clearTimeout(timer);
      return fired;
    },
    get fired() {
      return fired;
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { withTimeout, startWatchdog };
}
