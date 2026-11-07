/**
 * 侧栏「给当前网页生成建议」的进度出口。
 *
 * 同一份进度既广播给发起点击的侧栏，也写一份会话快照供侧栏重开后续显。
 * 进度纯属体验数据：没有监听方或存储失败一律吞掉，绝不影响生成结果。
 */

'use strict';

/**
 * 侧栏生成进度广播：消息只带 runId + 结构化阶段，不作为生成结果的一部分。
 * 没有监听方（侧栏已关）或广播失败都吞掉——进度只是体验，不能影响生成。
 * @param {string} runId
 * @param {{stage: string, percent: number}} progress
 */
function emitAgentSuggestionsProgress(runId, progress) {
  const id = String(runId || '').trim();
  if (!id || !progress) return;
  const runtime = typeof chrome !== 'undefined' && chrome && chrome.runtime ? chrome.runtime : null;
  if (!runtime || typeof runtime.sendMessage !== 'function') return;
  try {
    const pending = runtime.sendMessage({
      action: 'agentSuggestionsProgress',
      runId: id,
      progress,
    });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (e) {
    console.warn('[taskChromePlugin] agent suggestions progress broadcast failed:', e?.message || e);
  }
}

/**
 * 进度快照写 `chrome.storage.session`：侧栏关掉再打开时据此续显。
 * 只是体验数据，任何失败都吞掉，绝不影响生成。
 */
function persistAgentSuggestionsProgress(tabId, runId, progress, startedAt) {
  const Store = typeof AgentSuggestionsProgressStore !== 'undefined'
    ? AgentSuggestionsProgressStore
    : null;
  const id = String(runId || '').trim();
  const tab = Number(tabId);
  if (!Store || !id || !Number.isInteger(tab) || tab < 0 || !progress) return;
  const stage = String(progress.stage || '');
  if (stage === 'done' || stage === 'failed') {
    Store.clear(tab);
    return;
  }
  Store.save(tab, {
    runId: id,
    stage,
    percent: progress.percent,
    startedAt,
  });
}

/**
 * 一次生成的进度出口：同一个 runId 既广播给发起点击的侧栏，也落一条会话快照。
 * 没有 runId（Alt+Z 等旧路径）时整体 no-op。
 */
function createAgentSuggestionsProgressReporter(runId, tabId, startedAt) {
  const id = String(runId || '').trim();
  const started = Number(startedAt) > 0 ? Number(startedAt) : Date.now();
  // 阶段时间线进诊断记录：失败时能回答「卡在采集、提交、生成还是落贴」。
  const timeline = [];
  function record(progress) {
    if (!progress) return;
    const stage = String(progress.stage || '').trim();
    if (!stage) return;
    const t = Math.max(0, Date.now() - started);
    const last = timeline[timeline.length - 1];
    // 同一阶段重复上报只更新时间，不制造一串同阶段节点。
    if (last && last.stage === stage) {
      last.t = t;
      return;
    }
    timeline.push({ stage, t });
    if (timeline.length > 24) timeline.shift();
  }
  return {
    enabled: !!id,
    /** 只写快照不广播：给「点击后、首个阶段事件前」的初始进度用。 */
    snapshot(progress) {
      if (!id || !progress) return;
      record(progress);
      persistAgentSuggestionsProgress(tabId, id, progress, started);
    },
    report(progress) {
      if (!id || !progress) return;
      record(progress);
      emitAgentSuggestionsProgress(id, progress);
      persistAgentSuggestionsProgress(tabId, id, progress, started);
    },
    /** @returns {{stage: string, t: number}[]} */
    getTimeline() {
      return timeline.map((row) => ({ stage: row.stage, t: row.t }));
    },
  };
}
