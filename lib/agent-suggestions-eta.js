/**
 * 「给当前网页生成建议」的耗时自学习：用最近几次成功生成的整次耗时，
 * 估算下一次从点击到出结果大约要多久（替代写死的 60s 基准）。
 *
 * 只统计成功跑完的整次生成：采集失败、未登录等 0.x 秒早退的失败若进入样本，
 * 会把预估值拉低到不可用；偶发超慢任务用中位数抗抖动。
 *
 * 样本存 `chrome.storage.local`（最多 MAX_SAMPLES 条），只保留毫秒数，
 * 不含页面内容/账号信息。任何存储失败都回退默认值，绝不影响生成主流程。
 */
const AgentSuggestionsEta = (() => {
  'use strict';

  const STORAGE_KEY = 'agentSuggestionsEtaSamples';
  // 与 lib/agent-suggestions-diagnostics.js 的 KEY 同源；该模块未加载时（如侧栏）
  // 用这里的字面量直读同一份数据，升级后第一次点击也能用上历史耗时。
  const DIAGNOSTICS_KEY = 'agentSuggestionsDiagnostics';
  // 诊断记录里代表「建议已生成」的结果，可作为首次估时的历史样本。
  const DIAGNOSTICS_SEED_RESULTS = ['success', 'no_post', 'post_failed'];
  // 与 lib/agent-suggestions-progress.js 的 EXPECTED_GENERATE_MS 同值：
  // 没有历史样本时仍按 60s 给第一次估算。
  const DEFAULT_TOTAL_MS = 60000;
  // 奇数条便于取中位数；9 条足够反映近期速度，又不会被很久以前的慢任务拖住。
  const MAX_SAMPLES = 9;
  // 一次成功生成不可能 1s 内完成；更小的值一律视为异常样本。
  const MIN_SAMPLE_MS = 1000;
  const MIN_ESTIMATE_MS = 3000;
  // 服务端 poll 上限 105s，再加采集/落贴；超过 3 分钟的样本视为异常。
  const MAX_ESTIMATE_MS = 180000;

  /** SW / 扩展页优先用 lib/storage.js 的全局；单测可注入 globalThis.Storage。 */
  function storageApi() {
    if (typeof Storage !== 'undefined' && Storage
      && typeof Storage.get === 'function' && typeof Storage.set === 'function') {
      return Storage;
    }
    try {
      const area = typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local
        ? chrome.storage.local
        : null;
      if (area && typeof area.get === 'function' && typeof area.set === 'function') return area;
    } catch (_e) { /* fall through */ }
    return null;
  }

  function normalizeSample(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return null;
    const rounded = Math.round(ms);
    if (rounded < MIN_SAMPLE_MS || rounded > MAX_ESTIMATE_MS) return null;
    return rounded;
  }

  /** 过滤无效/异常样本，只保留最近 MAX_SAMPLES 条（旧 → 新）。 */
  function normalizeSamples(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    for (const value of list) {
      const ms = normalizeSample(value);
      if (ms !== null) out.push(ms);
    }
    return out.slice(-MAX_SAMPLES);
  }

  function median(sorted) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  /**
   * 历史样本 → 下一次总时长估计。空样本/全部异常时回退默认 60s。
   * @param {Array<number>} rawSamples
   * @returns {number}
   */
  function estimateMs(rawSamples) {
    const samples = normalizeSamples(rawSamples);
    if (!samples.length) return DEFAULT_TOTAL_MS;
    const value = median(samples.slice().sort((a, b) => a - b));
    return Math.min(MAX_ESTIMATE_MS, Math.max(MIN_ESTIMATE_MS, value));
  }

  async function loadSamples() {
    const api = storageApi();
    if (!api) return [];
    try {
      const got = await api.get([STORAGE_KEY]);
      return normalizeSamples(got && got[STORAGE_KEY]);
    } catch (_e) {
      return [];
    }
  }

  /**
   * ETA 样本还没积累时，从诊断环形记录里挑出「建议已生成」的耗时兜底。
   * 只在样本为空时使用，不会让同一批历史被反复计入。
   */
  async function loadDiagnosticsSamples() {
    const api = storageApi();
    if (!api) return [];
    try {
      const got = await api.get([DIAGNOSTICS_KEY]);
      const rows = got && got[DIAGNOSTICS_KEY];
      if (!Array.isArray(rows)) return [];
      const elapsed = rows
        .filter((row) => row && DIAGNOSTICS_SEED_RESULTS.includes(String(row.result || '')))
        .map((row) => Number(row.elapsedMs))
        .filter((ms) => Number.isFinite(ms) && ms > 0);
      return normalizeSamples(elapsed);
    } catch (_e) {
      return [];
    }
  }

  /** 读取历史样本并给出下一次的总时长估计；失败回落默认值。 */
  async function expectedMs() {
    const samples = await loadSamples();
    if (samples.length) return estimateMs(samples);
    return estimateMs(await loadDiagnosticsSamples());
  }

  /**
   * 记一次成功生成的整次耗时（毫秒）。失败/异常短样本不落盘。
   * @param {number} elapsedMs
   * @returns {Promise<boolean>} 是否写入成功
   */
  async function record(elapsedMs) {
    const sample = normalizeSample(elapsedMs);
    if (sample === null) return false;
    const api = storageApi();
    if (!api) return false;
    const samples = await loadSamples();
    const next = samples.concat([sample]).slice(-MAX_SAMPLES);
    try {
      await api.set({ [STORAGE_KEY]: next });
      return true;
    } catch (_e) {
      return false;
    }
  }

  return {
    STORAGE_KEY,
    DIAGNOSTICS_KEY,
    DEFAULT_TOTAL_MS,
    MAX_SAMPLES,
    MIN_SAMPLE_MS,
    MIN_ESTIMATE_MS,
    MAX_ESTIMATE_MS,
    normalizeSamples,
    estimateMs,
    loadSamples,
    expectedMs,
    record,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentSuggestionsEta;
if (typeof globalThis !== 'undefined') globalThis.AgentSuggestionsEta = AgentSuggestionsEta;
