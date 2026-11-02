/**
 * 「给当前网页生成建议」的进度模型（侧栏进度条与后台上报共用）。
 *
 * 服务端 suggest job 只回 queued / running / succeeded / failed 四个状态，
 * 没有百分比。这里把可观测的阶段换算成 0–100 的进度：
 * 采集 → 提交 → 排队 → 模型生成 → 落贴。生成阶段按已耗时线性推进到 90%，
 * 终态由调用方补 95 / 100，绝不虚报完成；超过预估时长就停在 90% 等终态。
 */
const AgentSuggestionsProgress = (() => {
  'use strict';

  const STAGES = ['idle', 'capture', 'submit', 'queued', 'generating', 'posting', 'done', 'failed'];

  const STAGE_PERCENT = {
    idle: 0,
    capture: 8,
    submit: 16,
    queued: 25,
    generating: 35,
    posting: 95,
    done: 100,
    failed: 100,
  };

  // 本地心跳每 tick 前进 1%，最多到该阶段上限；没有新事件时也不会越过上限。
  const STAGE_CEILING = {
    idle: 0,
    capture: 12,
    submit: 24,
    queued: 34,
    generating: 90,
    posting: 99,
    done: 100,
    failed: 100,
  };

  // 现网成功 job 常见 17–27s；按 30s 线性推进，慢任务停在 90% 等终态。
  const EXPECTED_GENERATE_MS = 30000;

  function normalizeStage(value) {
    const stage = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(STAGE_PERCENT, stage) ? stage : 'idle';
  }

  /** 服务端 job 状态 → 进度阶段。未知状态按「仍在生成」处理。 */
  function stageForJobStatus(status) {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'queued') return 'queued';
    if (s === 'succeeded') return 'posting';
    if (s === 'failed' || s === 'expired') return 'failed';
    return 'generating';
  }

  function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function stagePercent(stage) {
    return STAGE_PERCENT[normalizeStage(stage)];
  }

  function stageCeiling(stage) {
    return STAGE_CEILING[normalizeStage(stage)];
  }

  function isTerminal(stage) {
    const s = normalizeStage(stage);
    return s === 'done' || s === 'failed';
  }

  /**
   * 按「生成阶段已耗时」估算剩余时长：只用于展示，不参与进度百分比。
   * 超过预估返回 0，调用方显示「即将完成」，不要倒计时成负数。
   */
  function remainingMs(elapsedMs, expectedMs) {
    const expected = Number(expectedMs) > 0 ? Number(expectedMs) : EXPECTED_GENERATE_MS;
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    return Math.max(0, expected - elapsed);
  }

  /** 后台事件 → 显示百分比；事件没带 percent 时用阶段起点。 */
  function percentForEvent(event) {
    const stage = normalizeStage(event && event.stage);
    const raw = Number(event && event.percent);
    return Number.isFinite(raw) ? clampPercent(raw) : stagePercent(stage);
  }

  /** 本地心跳：只前进、不倒退；阶段上限封顶。 */
  function tickPercent(current, stage) {
    const pct = clampPercent(current);
    const normalized = normalizeStage(stage);
    if (normalized === 'done') return 100;
    if (normalized === 'failed') return pct;
    return Math.max(pct, Math.min(stageCeiling(normalized), pct + 1));
  }

  /**
   * poll 一次得到的状态 → 进度：排队 25→35%，生成 35→90% 按已耗时线性推进；
   * 终态分别给 95%（落贴）/ 100%（失败）。
   */
  function percentForPoll(input) {
    const status = input && input.status;
    const stage = stageForJobStatus(status);
    if (stage === 'posting') return 95;
    if (stage === 'failed') return 100;
    const expected = Number(input && input.expectedMs) > 0
      ? Number(input.expectedMs)
      : EXPECTED_GENERATE_MS;
    const elapsed = Math.max(0, Number(input && input.elapsedMs) || 0);
    const ratio = Math.min(1, elapsed / expected);
    if (stage === 'queued') return clampPercent(25 + 10 * ratio);
    return clampPercent(35 + 55 * ratio);
  }

  return {
    STAGES,
    EXPECTED_GENERATE_MS,
    normalizeStage,
    stageForJobStatus,
    clampPercent,
    stagePercent,
    stageCeiling,
    isTerminal,
    remainingMs,
    percentForEvent,
    tickPercent,
    percentForPoll,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentSuggestionsProgress;
if (typeof globalThis !== 'undefined') globalThis.AgentSuggestionsProgress = AgentSuggestionsProgress;
