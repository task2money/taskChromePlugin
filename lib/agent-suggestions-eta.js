/**
 * 「给当前网页生成建议」的耗时自学习：用最近几次成功生成的整次耗时，
 * 估算下一次从点击到出结果大约要多久（替代写死的 60s 基准）。
 *
 * 只统计成功跑完的整次生成：采集失败、未登录等 0.x 秒早退的失败若进入样本，
 * 会把预估值拉低到不可用；偶发超慢任务用中位数抗抖动。
 *
 * 样本分层（OPT-20261107-006）：轻量短页与长文档/多图页的耗时差异很大，
 * 全局中位数会把两类混在一起。记录时同时写入 host 桶、页面字符数桶和
 * host+size 组合桶；估算时优先用同一分桶的样本，没有样本再回退全局。
 * 分桶数上限 MAX_BUCKETS，避免访问站点越多键无限增长。
 *
 * 阶段校准（OPT-20261107-007）：成功生成时同时记录采集/提交/排队/生成/落贴
 * 各阶段耗时（STAGES_KEY），运行中按当前阶段已用时与历史阶段中位数重算剩余，
 * 不再只靠启动时一次取定的总时长。只用毫秒数，不含页面内容或账号信息。
 *
 * 存储兼容：全局样本仍存在 STORAGE_KEY 的纯数值数组里（旧版本可读），
 * 分桶样本单独放 BUCKETS_KEY，阶段样本放 STAGES_KEY；任何存储失败都回退
 * 默认值，绝不影响生成主流程。
 */
const AgentSuggestionsEta = (() => {
  'use strict';

  const STORAGE_KEY = 'agentSuggestionsEtaSamples';
  // 分桶样本；与 STORAGE_KEY 分开存，旧版本读全局数组不受影响。
  const BUCKETS_KEY = 'agentSuggestionsEtaBuckets';
  // 阶段耗时样本（OPT-20261107-007）：各阶段占比相对稳定，运行中可用
  // 「已完成阶段的实际用时 + 历史阶段中位数」重新推算剩余时间。
  const STAGES_KEY = 'agentSuggestionsEtaStageMs';
  const STAGE_ORDER = ['capture', 'submit', 'queued', 'generating', 'posting'];
  // 阶段耗时只需反映近期速度；7 条足够取中位数，也不会被很久以前的慢任务拖住。
  const MAX_STAGE_SAMPLES = 7;
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
  // 每个分桶保留最近 5 条：分桶要更快贴近站点实际速度，样本无需太多。
  const MAX_BUCKET_SAMPLES = 5;
  // 分桶键上限（h:/s:/hs: 合计）；超过时按写入顺序淘汰最旧的桶。
  const MAX_BUCKETS = 24;
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

  /** host 规范化：接受 host 或完整 URL；去掉 www./端口，拒绝非 host 字符。 */
  function normalizeHost(value) {
    let raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw.includes('://')) {
      try {
        raw = new URL(raw).host.toLowerCase();
      } catch (_e) {
        return '';
      }
    }
    raw = raw.replace(/^www\./, '');
    raw = raw.split('/')[0].split('?')[0].split('#')[0];
    // 去掉端口；IPv6（含 []/:）不做分桶，避免引入不可控键。
    const colon = raw.indexOf(':');
    if (colon >= 0) raw = raw.slice(0, colon);
    if (!raw || raw.length > 80) return '';
    if (!/^[a-z0-9.-]+$/.test(raw)) return '';
    return raw;
  }

  /** 页面采集字符数 → 轻/中/重分桶；未知或非法返回空串。 */
  function sizeBucket(chars) {
    const n = Number(chars);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 2000) return 's';
    if (n < 10000) return 'm';
    return 'l';
  }

  /** 上下文 → 候选分桶键（priority 顺序：组合 → host → size）。 */
  function bucketKeysFor(context) {
    const ctx = context && typeof context === 'object' ? context : {};
    const host = normalizeHost(ctx.host || ctx.url);
    const size = sizeBucket(ctx.chars);
    const keys = [];
    if (host) keys.push('h:' + host);
    if (size) keys.push('s:' + size);
    if (host && size) keys.push('hs:' + host + '|' + size);
    // 估算按「更具体优先」；记录顺序无关。
    return { host, size, keys };
  }

  function emptyBucketStore() {
    return { order: [], buckets: {} };
  }

  /** 读取并清洗分桶存储：非法样本丢弃，键数/每桶样本数都夹到上限。 */
  function normalizeBuckets(raw) {
    const store = emptyBucketStore();
    const src = raw && typeof raw === 'object' ? raw : {};
    const rawBuckets = src.buckets && typeof src.buckets === 'object' ? src.buckets : {};
    const rawOrder = Array.isArray(src.order) ? src.order : Object.keys(rawBuckets);
    for (const value of rawOrder) {
      const key = typeof value === 'string' ? value.trim() : '';
      if (!key || Object.prototype.hasOwnProperty.call(store.buckets, key)) continue;
      const samples = normalizeSamples(rawBuckets[key]).slice(-MAX_BUCKET_SAMPLES);
      if (!samples.length) continue;
      store.order.push(key);
      store.buckets[key] = samples;
      if (store.order.length >= MAX_BUCKETS) break;
    }
    return store;
  }

  function normalizeStageSample(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return null;
    const rounded = Math.round(ms);
    // 阶段耗时为 0 说明该阶段没真正耗时（或未观察），不留样本。
    if (rounded <= 0 || rounded > MAX_ESTIMATE_MS) return null;
    return rounded;
  }

  /** 清洗阶段样本存储：只留已知阶段，每组夹到 MAX_STAGE_SAMPLES。 */
  function normalizeStages(raw) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const stage of STAGE_ORDER) {
      const list = Array.isArray(src[stage]) ? src[stage] : [];
      const samples = [];
      for (const value of list) {
        const ms = normalizeStageSample(value);
        if (ms !== null) samples.push(ms);
      }
      if (samples.length) out[stage] = samples.slice(-MAX_STAGE_SAMPLES);
    }
    return out;
  }

  /** 一次读取全局样本 + 分桶样本 + 阶段样本，减少 chrome.storage 往返。 */
  async function loadState() {
    const api = storageApi();
    if (!api) return { samples: [], buckets: emptyBucketStore(), stages: {} };
    try {
      const got = await api.get([STORAGE_KEY, BUCKETS_KEY, STAGES_KEY]);
      return {
        samples: normalizeSamples(got && got[STORAGE_KEY]),
        buckets: normalizeBuckets(got && got[BUCKETS_KEY]),
        stages: normalizeStages(got && got[STAGES_KEY]),
      };
    } catch (_e) {
      return { samples: [], buckets: emptyBucketStore(), stages: {} };
    }
  }

  async function loadSamples() {
    return (await loadState()).samples;
  }

  async function loadBuckets() {
    return (await loadState()).buckets;
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

  /** 同分桶优先：组合桶 → host 桶 → size 桶；没有样本返回 null。 */
  function estimateFromBuckets(store, context) {
    const { host, size, keys } = bucketKeysFor(context);
    const priority = [];
    if (host && size) priority.push('hs:' + host + '|' + size);
    if (host) priority.push('h:' + host);
    if (size) priority.push('s:' + size);
    for (const key of priority) {
      const samples = store && store.buckets ? store.buckets[key] : null;
      if (samples && samples.length) return estimateMs(samples);
    }
    return null;
  }

  /**
   * 各阶段耗时中位数（毫秒）；没有样本的阶段不出现。
   * @returns {Promise<object>}
   */
  async function loadStageMedians() {
    const state = await loadState();
    const out = {};
    for (const stage of STAGE_ORDER) {
      const list = state.stages[stage];
      if (!list || !list.length) continue;
      out[stage] = median(list.slice().sort((a, b) => a - b));
    }
    return out;
  }

  /**
   * 运行中校准剩余时间（OPT-20261107-007）：当前阶段按历史中位数扣掉已耗时，
   * 后续阶段按各自中位数整段计入。同一阶段内随已耗时单调不增，阶段切换
   * 时连续；当前阶段及之后都没有样本时返回 null，调用方回退总时长 ETA。
   * @param {{ stage?: string, stageElapsedMs?: number, medians?: object }} input
   * @returns {number|null}
   */
  function stageRemainingMs(input) {
    const stage = String((input && input.stage) || '').trim();
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx < 0) return null;
    const medians = input && input.medians && typeof input.medians === 'object' ? input.medians : {};
    const stageElapsed = Math.max(0, Number(input && input.stageElapsedMs) || 0);
    let total = 0;
    let any = false;
    for (let i = idx; i < STAGE_ORDER.length; i += 1) {
      const value = Number(medians[STAGE_ORDER[i]]);
      if (!(value > 0)) continue;
      any = true;
      total += i === idx ? Math.max(0, value - stageElapsed) : value;
    }
    if (!any) return null;
    return Math.round(total);
  }

  /**
   * ETA 样本还没积累时，从诊断环形记录里挑出「建议已生成」的耗时兜底。
   * 只在全局样本为空时使用，不会让同一批历史被反复计入。
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

  /**
   * 读取历史样本并给出下一次的总时长估计；失败回落默认值。
   * 传 context（{host, chars}）时优先用同一分桶样本，没有则回退全局。
   */
  async function expectedMs(context) {
    const state = await loadState();
    const fromBucket = estimateFromBuckets(state.buckets, context);
    if (fromBucket !== null) return fromBucket;
    if (state.samples.length) return estimateMs(state.samples);
    return estimateMs(await loadDiagnosticsSamples());
  }

  /**
   * 把本次各阶段耗时并入已有样本；没有任何有效阶段时返回 null（不覆盖旧样本）。
   */
  function mergeStageSamples(existing, context) {
    const input = context && context.stages && typeof context.stages === 'object'
      ? context.stages
      : null;
    if (!input) return null;
    const store = normalizeStages(existing);
    let changed = false;
    for (const stage of STAGE_ORDER) {
      const sample = normalizeStageSample(input[stage]);
      if (sample === null) continue;
      store[stage] = (store[stage] || []).concat([sample]).slice(-MAX_STAGE_SAMPLES);
      changed = true;
    }
    return changed ? store : null;
  }

  /**
   * 记一次成功生成的整次耗时（毫秒）。失败/异常短样本不落盘。
   * context 可选：{host, chars, stages}。host/chars 写分桶样本，
   * stages（各阶段耗时）写阶段样本；全局样本始终同时写入。
   * @param {number} elapsedMs
   * @param {{host?: string, url?: string, chars?: number, stages?: object}} [context]
   * @returns {Promise<boolean>} 是否写入成功
   */
  async function record(elapsedMs, context) {
    const sample = normalizeSample(elapsedMs);
    if (sample === null) return false;
    const api = storageApi();
    if (!api) return false;
    const state = await loadState();
    const next = state.samples.concat([sample]).slice(-MAX_SAMPLES);

    const { keys } = bucketKeysFor(context);
    const store = state.buckets || emptyBucketStore();
    for (const key of keys) {
      const existing = store.buckets[key] || [];
      store.buckets[key] = existing.concat([sample]).slice(-MAX_BUCKET_SAMPLES);
      if (!store.order.includes(key)) store.order.push(key);
    }
    // 有界：超过 MAX_BUCKETS 时淘汰最旧的桶（order 头部）。
    while (store.order.length > MAX_BUCKETS) {
      const evicted = store.order.shift();
      delete store.buckets[evicted];
    }

    const patch = { [STORAGE_KEY]: next };
    if (keys.length) patch[BUCKETS_KEY] = { order: store.order, buckets: store.buckets };
    const stagePatch = mergeStageSamples(state.stages, context);
    if (stagePatch) patch[STAGES_KEY] = stagePatch;
    try {
      await api.set(patch);
      return true;
    } catch (_e) {
      return false;
    }
  }

  return {
    STORAGE_KEY,
    BUCKETS_KEY,
    STAGES_KEY,
    STAGE_ORDER,
    DIAGNOSTICS_KEY,
    DEFAULT_TOTAL_MS,
    MAX_SAMPLES,
    MAX_BUCKET_SAMPLES,
    MAX_BUCKETS,
    MAX_STAGE_SAMPLES,
    MIN_SAMPLE_MS,
    MIN_ESTIMATE_MS,
    MAX_ESTIMATE_MS,
    normalizeHost,
    sizeBucket,
    bucketKeysFor,
    normalizeSamples,
    normalizeBuckets,
    normalizeStages,
    estimateMs,
    estimateFromBuckets,
    loadSamples,
    loadBuckets,
    loadStageMedians,
    stageRemainingMs,
    expectedMs,
    record,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentSuggestionsEta;
if (typeof globalThis !== 'undefined') globalThis.AgentSuggestionsEta = AgentSuggestionsEta;
