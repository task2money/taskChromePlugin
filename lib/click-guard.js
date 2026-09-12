/**
 * 同步点击防重放（插件侧，无 Vue）。
 * 对齐 taskFE createClickGuard：busy 门闩 + 短窗 debounce + Idempotency-Key。
 */

'use strict';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* ignore */ }
  return `ik-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function mergeIdempotencyHeaders(headers, key) {
  const next = { ...(headers || {}) };
  if (key) next[IDEMPOTENCY_HEADER] = key;
  return next;
}

/**
 * @param {{ debounceMs?: number, now?: () => number, newKey?: () => string }} [options]
 */
function createClickGuard(options = {}) {
  const debounceMs = options.debounceMs ?? 300;
  const now = options.now || (() => Date.now());
  const newKey = options.newKey || newIdempotencyKey;
  const busy = { value: false };
  let lastAcceptedAt = 0;
  let currentKey = '';

  return {
    busy,
    isBusy: () => busy.value,
    currentKey: () => currentKey,
    async run(fn) {
      const t = now();
      if (busy.value) {
        return { skipped: true, reason: 'in-flight' };
      }
      if (lastAcceptedAt && t - lastAcceptedAt < debounceMs) {
        return { skipped: true, reason: 'debounce' };
      }
      busy.value = true;
      lastAcceptedAt = t;
      currentKey = newKey();
      try {
        const result = await fn({
          idempotencyKey: currentKey,
          headers: { [IDEMPOTENCY_HEADER]: currentKey },
        });
        return { skipped: false, result };
      } finally {
        busy.value = false;
      }
    },
  };
}

const ClickGuard = {
  IDEMPOTENCY_HEADER,
  newIdempotencyKey,
  mergeIdempotencyHeaders,
  createClickGuard,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClickGuard;
}
if (typeof globalThis !== 'undefined') {
  globalThis.ClickGuard = ClickGuard;
}
