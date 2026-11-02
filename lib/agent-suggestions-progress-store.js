/**
 * 侧栏生成进度的会话级快照：侧栏关闭再打开时据此续显。
 *
 * 用 `chrome.storage.session` 而非 local：
 * - 只服务本次浏览器会话，重启浏览器后没有续显意义；
 * - 不落盘、不同步，进度不是需要长期保留的数据。
 *
 * 后台在每次进度事件上覆盖写一条（按 tab 隔离），终态删除；
 * 读取时超过 TTL 视为后台已中断，顺手清掉，避免重开侧栏看到僵尸进度。
 */
const AgentSuggestionsProgressStore = (() => {
  'use strict';

  const PREFIX = 'agentSuggestionsProgress:';
  // 生成最长 75s 轮询 + 落贴；90s 没有新事件基本可判定后台流程已断。
  const TTL_MS = 90000;

  function sessionArea() {
    try {
      return typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.session
        ? chrome.storage.session
        : null;
    } catch (_e) {
      return null;
    }
  }

  function validTabId(tabId) {
    const id = Number(tabId);
    return Number.isInteger(id) && id >= 0;
  }

  function keyFor(tabId) {
    return PREFIX + String(Number(tabId));
  }

  function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function normalize(snapshot, now) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const runId = String(snapshot.runId || '').trim();
    if (!runId) return null;
    const startedAt = Number(snapshot.startedAt);
    return {
      runId,
      stage: String(snapshot.stage || '').trim(),
      percent: clampPercent(snapshot.percent),
      startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : now,
      updatedAt: now,
    };
  }

  async function save(tabId, snapshot) {
    if (!validTabId(tabId)) return false;
    const area = sessionArea();
    if (!area || typeof area.set !== 'function') return false;
    const now = Date.now();
    const record = normalize(snapshot, now);
    if (!record) return false;
    try {
      await area.set({ [keyFor(tabId)]: record });
      return true;
    } catch (_e) {
      return false;
    }
  }

  async function load(tabId, nowMs) {
    if (!validTabId(tabId)) return null;
    const area = sessionArea();
    if (!area || typeof area.get !== 'function') return null;
    const key = keyFor(tabId);
    try {
      const got = await area.get(key);
      const record = got && got[key];
      if (!record || !String(record.runId || '').trim()) return null;
      const now = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
      const updatedAt = Number(record.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > TTL_MS) {
        if (typeof area.remove === 'function') await area.remove(key);
        return null;
      }
      const startedAt = Number(record.startedAt);
      return {
        tabId: Number(tabId),
        runId: String(record.runId),
        stage: String(record.stage || ''),
        percent: clampPercent(record.percent),
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : updatedAt,
        updatedAt,
      };
    } catch (_e) {
      return null;
    }
  }

  async function clear(tabId) {
    if (!validTabId(tabId)) return false;
    const area = sessionArea();
    if (!area || typeof area.remove !== 'function') return false;
    try {
      await area.remove(keyFor(tabId));
      return true;
    } catch (_e) {
      return false;
    }
  }

  return {
    PREFIX,
    TTL_MS,
    save,
    load,
    clear,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentSuggestionsProgressStore;
if (typeof globalThis !== 'undefined') globalThis.AgentSuggestionsProgressStore = AgentSuggestionsProgressStore;
