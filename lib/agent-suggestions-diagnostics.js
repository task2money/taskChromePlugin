/**
 * 「给当前网页生成建议」的本地诊断中心（环形缓冲）。
 *
 * 用户反馈「生成失败 / 进度条走完就没了 / 没有帖子」时，没有任何可粘贴给
 * 客服或 Agent 的线索。这里把每次终态（成功落贴 / 成功未落贴 / 落贴失败 /
 * 生成失败）记一条到 `chrome.storage.local`，侧栏只经后台消息读取，保持单一
 * 数据源。
 *
 * 隐私边界（硬约束）：
 * - 不记录页面正文、DOM 正文、token、cookie、accessCode；
 * - `pageUrl` 去 query / hash（优先复用 PageAdvisorSitePending 的同口径实现）；
 * - 单条 ≤ 8KB，最多 10 条，超出丢最旧；任何存储失败都吞掉，不影响生成。
 */
const AgentSuggestionsDiagnostics = (() => {
  'use strict';

  const KEY = 'agentSuggestionsDiagnostics';
  const MAX = 10;
  const URL_MAX = 2048;
  const ENTRY_MAX_BYTES = 8 * 1024;

  const EMPTY = '';

  function storageArea() {
    try {
      return typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local
        ? chrome.storage.local
        : null;
    } catch (_e) {
      return null;
    }
  }

  function text(value, maxLen) {
    const s = String(value == null ? '' : value).trim();
    if (!s) return EMPTY;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  function finiteInt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  }

  /** 去 query / hash：优先复用侧栏/后台共用的 URL 口径，缺失时本地兜底。 */
  function sanitizeUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    try {
      const Pending = typeof PageAdvisorSitePending !== 'undefined' ? PageAdvisorSitePending : null;
      if (Pending && typeof Pending.pageUrlForAgentSuggestions === 'function') {
        return text(Pending.pageUrlForAgentSuggestions(raw), URL_MAX);
      }
    } catch (_e) { /* fall through */ }
    try {
      const parsed = new URL(raw);
      parsed.search = '';
      parsed.hash = '';
      return text(parsed.href, URL_MAX);
    } catch (_e) {
      return text(raw.split('#')[0].split('?')[0], URL_MAX);
    }
  }

  function normalizeQuota(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const quota = {};
    if (raw.enabled !== undefined) quota.enabled = !!raw.enabled;
    const remaining = finiteInt(raw.remaining);
    if (remaining !== null) quota.remaining = remaining;
    const daily = finiteInt(raw.daily_quota);
    if (daily !== null) quota.daily_quota = daily;
    const resetsAt = text(raw.resets_at, 64);
    if (resetsAt) quota.resets_at = resetsAt;
    return Object.keys(quota).length ? quota : null;
  }

  function normalizeTimeline(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row) => row && typeof row === 'object')
      .slice(-12)
      .map((row) => ({
        stage: text(row.stage, 24),
        t: finiteInt(row.t) || 0,
      }))
      .filter((row) => !!row.stage);
  }

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const at = text(raw.at, 64);
    const entry = {
      v: 1,
      at: at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString(),
      tabId: finiteInt(raw.tabId) || 0,
      pageUrl: sanitizeUrl(raw.pageUrl),
      route: text(raw.route, 24),
      runId: text(raw.runId, 128),
      result: text(raw.result, 24),
      errorCode: text(raw.errorCode, 96),
      errorText: text(raw.errorText, 500),
      traceId: text(raw.traceId, 128),
      retryable: raw.retryable === undefined ? null : !!raw.retryable,
      elapsedMs: finiteInt(raw.elapsedMs),
      attempts: finiteInt(raw.attempts),
      model: text(raw.model, 120),
      promptSkillId: text(raw.promptSkillId, 128),
      trialId: text(raw.trialId, 128),
      jobId: text(raw.jobId, 128),
      postId: text(raw.postId, 128),
      postError: text(raw.postError, 64),
      quota: normalizeQuota(raw.quota),
      stageTimeline: normalizeTimeline(raw.stageTimeline),
      pluginVersion: text(raw.pluginVersion, 32),
    };
    return fitEntry(entry);
  }

  function byteLength(value) {
    const s = String(value || '');
    try {
      return new TextEncoder().encode(s).length;
    } catch (_e) {
      return s.length;
    }
  }

  /**
   * 单条 ≤ 8KB：先截正文与 URL，再压缩时间线 / 额度，最后仍超标就丢弃。
   * 诊断只是辅助信息，绝不因为一条记录过大让整个缓冲写失败。
   */
  function fitEntry(entry) {
    let size = byteLength(JSON.stringify(entry));
    if (size <= ENTRY_MAX_BYTES) return entry;
    entry.errorText = text(entry.errorText, 200);
    entry.pageUrl = text(entry.pageUrl, 512);
    entry.stageTimeline = entry.stageTimeline.slice(-6);
    size = byteLength(JSON.stringify(entry));
    if (size <= ENTRY_MAX_BYTES) return entry;
    entry.quota = null;
    size = byteLength(JSON.stringify(entry));
    if (size <= ENTRY_MAX_BYTES) return entry;
    entry.errorText = text(entry.errorText, 80);
    entry.stageTimeline = [];
    size = byteLength(JSON.stringify(entry));
    return size <= ENTRY_MAX_BYTES ? entry : null;
  }

  function sameAttempt(a, b) {
    if (!a || !b) return false;
    const runA = String(a.runId || '');
    const runB = String(b.runId || '');
    if (runA || runB) return runA === runB;
    return String(a.at || '') === String(b.at || '');
  }

  async function readAll(area) {
    try {
      const got = await area.get(KEY);
      const rows = got && got[KEY];
      return Array.isArray(rows) ? rows : [];
    } catch (_e) {
      return [];
    }
  }

  // 读-改-写串行化：同一上下文里并发 append 不会互相覆盖。
  let writeChain = Promise.resolve();

  function enqueue(task) {
    const run = writeChain.then(task, task);
    writeChain = run.catch(() => {});
    return run;
  }

  /**
   * 追加一条终态记录。返回是否写入成功；任何失败都吞掉（诊断不影响生成）。
   * @param {object} rawEntry
   * @returns {Promise<boolean>}
   */
  function append(rawEntry) {
    const entry = normalizeEntry(rawEntry);
    if (!entry) return Promise.resolve(false);
    return enqueue(async () => {
      const area = storageArea();
      if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') return false;
      const rows = await readAll(area);
      const next = [entry]
        .concat(rows.filter((row) => !sameAttempt(row, entry)))
        .slice(0, MAX);
      await area.set({ [KEY]: next });
      return true;
    }).catch(() => false);
  }

  /** @returns {Promise<object[]>} 最近 10 条，新 → 旧。 */
  async function list() {
    const area = storageArea();
    if (!area || typeof area.get !== 'function') return [];
    const rows = await readAll(area);
    return rows.slice(0, MAX).map((row) => (row && typeof row === 'object' ? row : null)).filter(Boolean);
  }

  /** 当前 tab 最近一条；没有同 tab 记录时退回全局最近一条。 */
  async function latestForTab(tabId) {
    const rows = await list();
    if (!rows.length) return null;
    const id = Number(tabId);
    if (Number.isInteger(id) && id >= 0) {
      const hit = rows.find((row) => Number(row.tabId) === id);
      if (hit) return hit;
    }
    return rows[0];
  }

  async function clear() {
    return enqueue(async () => {
      const area = storageArea();
      if (!area || typeof area.remove !== 'function') return false;
      await area.remove(KEY);
      return true;
    }).catch(() => false);
  }

  // ---- 复制文本 ------------------------------------------------------------

  function tr(key, fallback, vars) {
    let out = fallback;
    try {
      if (typeof tx === 'function') {
        const got = tx(key, vars);
        if (got && got !== key) out = got;
      }
    } catch (_e) { /* fallback */ }
    if (vars) {
      Object.keys(vars).forEach((name) => {
        out = out.split(`{${name}}`).join(String(vars[name]));
      });
    }
    return out;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 2026-11-07 16:47:44 +08:00（本地时区）。 */
  function formatEntryTime(at) {
    const d = new Date(String(at || ''));
    if (Number.isNaN(d.getTime())) return String(at || '');
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const oh = pad2(Math.floor(Math.abs(offset) / 60));
    const om = pad2(Math.abs(offset) % 60);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
      + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${sign}${oh}:${om}`;
  }

  function shortTime(at) {
    const d = new Date(String(at || ''));
    if (Number.isNaN(d.getTime())) return '--:--:--';
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function routeLabel(route) {
    const value = String(route || '').trim();
    if (value === 'trial') return tr('agentSuggestionsDiagRouteTrial', '匿名试用');
    if (value === 'saas' || value === 'platform') return tr('agentSuggestionsDiagRoutePlatform', '登录态');
    return tr('agentSuggestionsDiagRouteUnknown', '未知');
  }

  function resultLabel(entry) {
    const value = String(entry && entry.result || '').trim();
    if (value === 'post_failed') {
      return tr('agentSuggestionsDiagResultPostFailed', '成功（落贴失败）');
    }
    if (value === 'no_post') return tr('agentSuggestionsDiagResultNoPost', '成功（未落贴）');
    if (value === 'success') return tr('agentSuggestionsDiagResultSuccess', '成功');
    return tr('agentSuggestionsDiagResultFailed', '失败');
  }

  function secondsText(ms) {
    const n = Number(ms);
    return Number.isFinite(n) && n >= 0 ? `${(n / 1000).toFixed(1)}s` : '';
  }

  function shortTrace(traceId) {
    const s = String(traceId || '');
    return s.length > 8 ? `${s.slice(0, 8)}…` : s;
  }

  function entryCode(entry) {
    const code = String(entry && entry.errorCode || '').trim();
    if (code) return code;
    const postError = String(entry && entry.postError || '').trim();
    return postError ? `post_${postError}` : '';
  }

  function pushLine(lines, label, value) {
    const v = String(value == null ? '' : value).trim();
    if (v) lines.push(`${label}: ${v}`);
  }

  /**
   * 拼出可直接粘贴给客服 / Agent 的诊断文本；不含页面正文。
   * @param {object|null} current 当前这次尝试
   * @param {object[]} [recent] 最近尝试（新 → 旧）
   */
  function buildCopyText(current, recent) {
    const cur = current && typeof current === 'object' ? current : null;
    const all = Array.isArray(recent) ? recent.filter((row) => row && typeof row === 'object') : [];
    const rest = all.filter((row) => !(cur && sameAttempt(row, cur)));
    const lines = [tr('agentSuggestionsDiagTitle', '【网页优化 · 给当前网页生成建议 · 诊断信息】')];

    if (cur) {
      pushLine(lines, tr('agentSuggestionsDiagTime', '时间'), formatEntryTime(cur.at));
      pushLine(lines, tr('agentSuggestionsDiagPluginVersion', '插件版本'), cur.pluginVersion);
      pushLine(lines, tr('agentSuggestionsDiagPage', '页面'), cur.pageUrl);
      pushLine(lines, tr('agentSuggestionsDiagRoute', '路由'), routeLabel(cur.route));
      pushLine(lines, tr('agentSuggestionsDiagResult', '结果'), resultLabel(cur));
      pushLine(lines, tr('agentSuggestionsDiagErrorCode', '错误码'), entryCode(cur));
      pushLine(lines, tr('agentSuggestionsDiagHint', '提示'), cur.errorText);
      pushLine(lines, tr('agentSuggestionsDiagTraceId', 'traceId'), cur.traceId);
      const elapsed = finiteInt(cur.elapsedMs);
      if (elapsed !== null) pushLine(lines, tr('agentSuggestionsDiagElapsed', '耗时'), `${elapsed} ms`);
      if (cur.retryable !== null && cur.retryable !== undefined) {
        pushLine(lines, tr('agentSuggestionsDiagRetryable', '可重试'),
          cur.retryable ? tr('agentSuggestionsDiagYes', '是') : tr('agentSuggestionsDiagNo', '否'));
      }
      const attempts = finiteInt(cur.attempts);
      if (attempts !== null) pushLine(lines, tr('agentSuggestionsDiagAttempts', '尝试次数'), attempts);
      pushLine(lines, tr('agentSuggestionsDiagModel', '模型'), cur.model);
      pushLine(lines, tr('agentSuggestionsDiagPrompt', '提示词'), cur.promptSkillId);
      pushLine(lines, tr('agentSuggestionsDiagTrialId', '试用ID'), cur.trialId);
      pushLine(lines, tr('agentSuggestionsDiagJobId', '任务ID'), cur.jobId);
      pushLine(lines, tr('agentSuggestionsDiagPostId', '帖子ID'), cur.postId);
      if (cur.postError) pushLine(lines, tr('agentSuggestionsDiagPostError', '落贴失败'), cur.postError);
      if (cur.quota && cur.quota.remaining !== undefined) {
        const remaining = finiteInt(cur.quota.remaining);
        const total = finiteInt(cur.quota.daily_quota);
        pushLine(lines, tr('agentSuggestionsDiagRemaining', '剩余次数'),
          total !== null ? `${remaining}/${total}` : String(remaining));
      }
      if (Array.isArray(cur.stageTimeline) && cur.stageTimeline.length) {
        pushLine(lines, tr('agentSuggestionsDiagTimeline', '阶段耗时'),
          cur.stageTimeline.map((row) => `${row.stage}@${row.t}ms`).join(' → '));
      }
    }

    if (rest.length) {
      lines.push('');
      lines.push(tr('agentSuggestionsDiagRecent', '最近尝试') + ':');
      rest.slice(0, MAX).forEach((entry, i) => {
        const parts = [shortTime(entry.at), routeLabel(entry.route), resultLabel(entry)];
        const code = entryCode(entry);
        if (code) parts.push(code);
        const elapsed = secondsText(entry.elapsedMs);
        if (elapsed) parts.push(elapsed);
        if (entry.postId) parts.push(`postId=${entry.postId}`);
        if (entry.traceId) parts.push(`traceId=${shortTrace(entry.traceId)}`);
        lines.push(`${i + 1}) ${parts.join(' ')}`);
      });
    }
    return lines.join('\n');
  }

  return {
    KEY,
    MAX,
    URL_MAX,
    ENTRY_MAX_BYTES,
    sanitizeUrl,
    normalizeEntry,
    append,
    list,
    latestForTab,
    clear,
    buildCopyText,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentSuggestionsDiagnostics;
if (typeof globalThis !== 'undefined') globalThis.AgentSuggestionsDiagnostics = AgentSuggestionsDiagnostics;
