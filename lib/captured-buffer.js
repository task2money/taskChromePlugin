/**
 * 捕获写入合批缓冲（OPT-20260808-019 捕获写合批节流；
 * OPT-20260808-023 F2 失败退避 + 兜底丢弃）
 *
 * 背景：SW 对每个网络请求做 session storage 全量读改写（最多 500 条数组
 * parse+stringify），轮询密集型页面（work-panel）把扩展进程打成写风暴。
 *
 * 行为：
 * - push() 只入内存队列；窗口内（flushIntervalMs）最多一次 flush
 * - 队列达到 maxEntries 立即 flush（不等窗口）
 * - flush 失败：批次重新入队（保持顺序），按指数退避调度重试（1s → 2s → … cap）
 * - 连续失败达到 maxRetries：丢弃该批次最旧数据（丢数据优于无限重试拖死全局），
 *   重置失败计数；flush 在途期间新 push 进入下一批次，同一批次绝不被并发写两次
 *
 * 纯逻辑实现，flush/scheduler 可注入（单测用手动调度器驱动计时）。
 */

/**
 * @param {{
 *   flush: (batch: object[]) => Promise<void>,
 *   flushIntervalMs?: number,
 *   maxEntries?: number,
 *   maxRetries?: number,
 *   maxBackoffMs?: number,
 *   scheduler?: (fn: () => void, ms: number) => object | { schedule: (fn: () => void, ms: number) => object, cancel: (t: object) => void },
 *   clearTimer?: (timer: object|null) => void,
 * }} opts
 */
function createCapturedBuffer(opts) {
  const flush = opts.flush;
  const flushIntervalMs = opts.flushIntervalMs || 1000;
  const maxEntries = opts.maxEntries || 500;
  // 连续失败达阈值即丢弃最旧批次，防止 storage 配额打满等持久故障下无限热循环
  const maxRetries = opts.maxRetries || 3;
  const maxBackoffMs = opts.maxBackoffMs || 30000;
  // scheduler 兼容两种形式：函数式 (fn, ms) => timer；对象式 { schedule, cancel }
  const sched = opts.scheduler || ((fn, ms) => setTimeout(fn, ms));
  const schedule = typeof sched === 'function' ? sched : (fn, ms) => sched.schedule(fn, ms);
  const clearTimer = typeof sched === 'function'
    ? (opts.clearTimer || ((t) => clearTimeout(t)))
    : (t) => sched.cancel(t);

  let pending = [];
  let timer = null;
  let flushing = null;
  let consecutiveFailures = 0;

  function cancelTimer() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function runFlush() {
    timer = null;
    void flushNow();
  }

  /** 失败重试的指数退避调度（1s → 2s → 4s … cap maxBackoffMs），绝不立即无退避重试 */
  function scheduleRetry() {
    if (timer != null) return;
    const backoffMs = Math.min(
      maxBackoffMs,
      flushIntervalMs * Math.pow(2, Math.max(0, consecutiveFailures - 1)),
    );
    timer = schedule(runFlush, backoffMs);
  }

  async function flushNow() {
    if (flushing) return; // 在途 flush 结束后会再次调度，绝不并发写同一批
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;

    flushing = true;
    try {
      await flush(batch);
      consecutiveFailures = 0;
    } catch (_) {
      // storage 写失败（如配额打满）：保持顺序重新入队，指数退避后重试；
      // 连续失败达阈值则丢弃该批次最旧数据（丢数据优于无限重试拖死全局）
      consecutiveFailures++;
      if (consecutiveFailures >= maxRetries) {
        consecutiveFailures = 0;
        if (typeof console !== 'undefined') {
          console.warn(
            `[taskChromePlugin] capturedBuffer 连续失败 ${maxRetries} 次，丢弃最旧批次（${batch.length} 条）`,
          );
        }
      } else {
        pending = [...batch, ...pending];
      }
    } finally {
      flushing = false;
      if (pending.length >= maxEntries) {
        cancelTimer();
        scheduleRetry();
      } else if (pending.length > 0 && timer == null) {
        timer = schedule(runFlush, flushIntervalMs);
      }
    }
  }

  return {
    /** @param {object} entry 捕获条目（已构建完成） */
    push(entry) {
      pending.push(entry);
      if (pending.length >= maxEntries) {
        cancelTimer();
        void flushNow();
        return;
      }
      if (timer == null) {
        timer = schedule(runFlush, flushIntervalMs);
      }
    },

    /** 立即冲刷（测试/关闭前兜底）；无队列时 no-op */
    flushNow() {
      cancelTimer();
      void flushNow();
    },

    /** 丢弃全部 pending（用户清空捕获列表时调用，避免下一轮 flush 回写） */
    discard() {
      cancelTimer();
      pending = [];
    },

    get pendingCount() {
      return pending.length;
    },
  };
}

const CapturedBuffer = { createCapturedBuffer };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CapturedBuffer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CapturedBuffer = CapturedBuffer;
}
