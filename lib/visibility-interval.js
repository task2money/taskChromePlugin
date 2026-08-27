/**
 * 可见性感知周期定时器
 *
 * 隐藏/后台标签页 clearInterval；回到可见时恢复并立即补一拍。
 * async onTick 未完成时跳过后续拍，避免 setInterval 重叠打 SW。
 *
 * 调度器可注入（单测用假时钟）。
 */

function createVisibilityAwareInterval(opts) {
  if (!opts || typeof opts.onTick !== 'function') {
    throw new Error('createVisibilityAwareInterval: onTick required');
  }
  const intervalMs = opts.intervalMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('createVisibilityAwareInterval: intervalMs must be > 0');
  }
  const onTick = opts.onTick;
  const isHidden = opts.isHidden || (() => false);
  const addVisibilityListener = opts.addVisibilityListener;
  const removeVisibilityListener = opts.removeVisibilityListener;
  const setIntervalFn = opts.setIntervalFn || ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = opts.clearIntervalFn || ((id) => clearInterval(id));

  let timer = null;
  let inFlight = false;
  let started = false;

  function hidden() {
    return !!isHidden();
  }

  function allowTick() {
    if (typeof shouldRunPeriodicAuthTick === 'function') {
      return shouldRunPeriodicAuthTick({ hidden: hidden(), inFlight });
    }
    return !hidden() && !inFlight;
  }

  async function tick() {
    if (!allowTick()) return;
    inFlight = true;
    try {
      await onTick();
    } finally {
      inFlight = false;
    }
  }

  function stopTimer() {
    if (timer != null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  function startTimer() {
    if (timer != null) return;
    timer = setIntervalFn(() => { void tick(); }, intervalMs);
  }

  function onVisibility() {
    if (hidden()) {
      stopTimer();
      return;
    }
    startTimer();
    void tick();
  }

  function start() {
    if (started) return;
    started = true;
    if (typeof addVisibilityListener === 'function') {
      addVisibilityListener(onVisibility);
    }
    if (!hidden()) startTimer();
  }

  function stop() {
    stopTimer();
    if (started && typeof removeVisibilityListener === 'function') {
      removeVisibilityListener(onVisibility);
    }
    started = false;
    inFlight = false;
  }

  return {
    start,
    stop,
    tick,
    get timerActive() { return timer != null; },
    get inFlight() { return inFlight; },
  };
}

/** document.hidden + visibilitychange 的默认接线；返回已 start 的控制器 */
function startDocumentVisibilityInterval(intervalMs, onTick) {
  const ctl = createVisibilityAwareInterval({
    intervalMs,
    onTick,
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    addVisibilityListener: (fn) => document.addEventListener('visibilitychange', fn),
    removeVisibilityListener: (fn) => document.removeEventListener('visibilitychange', fn),
  });
  ctl.start();
  return ctl;
}

const VisibilityInterval = { createVisibilityAwareInterval, startDocumentVisibilityInterval };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VisibilityInterval;
}
if (typeof globalThis !== 'undefined') {
  globalThis.VisibilityInterval = VisibilityInterval;
  globalThis.createVisibilityAwareInterval = createVisibilityAwareInterval;
  globalThis.startDocumentVisibilityInterval = startDocumentVisibilityInterval;
}
