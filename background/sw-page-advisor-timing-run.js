/** SW 侧 Alt+Z waterfall 编排：广播、span 包围、命令标记。 */

'use strict';

let pageAdvisorSuggestCommand = 'alt-z';
let pageAdvisorWaterfallTabId = 0;

function setPageAdvisorWaterfallTab(tabId) {
  const n = Number(tabId);
  pageAdvisorWaterfallTabId = Number.isFinite(n) && n > 0 ? n : 0;
}

function markPageAdvisorSuggestCommand(command) {
  pageAdvisorSuggestCommand = command === 'alt-shift-z' ? 'alt-shift-z' : 'alt-z';
}

function consumePageAdvisorSuggestCommand() {
  const command = pageAdvisorSuggestCommand;
  pageAdvisorSuggestCommand = 'alt-z';
  return command;
}

function newPageAdvisorRunId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wf_${crypto.randomUUID()}`;
  }
  return `wf_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function persistPageAdvisorWaterfallHistory(run) {
  if (!run || typeof PageAdvisorTiming === 'undefined') return;
  const payload = PageAdvisorTiming.serialize(run);
  try {
    const session = chrome.storage && chrome.storage.session;
    if (!session || typeof session.get !== 'function' || typeof session.set !== 'function') return;
    const pending = session.get(['pageAdvisorWaterfallHistory']);
    if (!pending || typeof pending.then !== 'function') return;
    pending.then((got) => {
      const hist = PageAdvisorTiming.rememberHistory(
        got && got.pageAdvisorWaterfallHistory,
        run,
        PageAdvisorTiming.MAX_HISTORY,
      );
      return session.set({
        pageAdvisorWaterfallCurrent: payload,
        pageAdvisorWaterfallHistory: hist,
      });
    }).catch(() => {});
  } catch (_) { /* ignore */ }
}

function broadcastPageAdvisorWaterfall(run) {
  if (!run || typeof PageAdvisorTiming === 'undefined') return;
  const payload = PageAdvisorTiming.serialize(run);
  try {
    const sent = chrome.runtime && chrome.runtime.sendMessage
      ? chrome.runtime.sendMessage({ action: 'pageAdvisorWaterfall', run: payload })
      : null;
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch (_) { /* no extension page listening */ }
  try {
    if (chrome.storage && chrome.storage.session && typeof chrome.storage.session.set === 'function') {
      chrome.storage.session.set({ pageAdvisorWaterfallCurrent: payload });
    }
  } catch (_) { /* ignore */ }
  const tabId = pageAdvisorWaterfallTabId;
  if (tabId && chrome.tabs && typeof chrome.tabs.sendMessage === 'function') {
    try {
      const sentTab = chrome.tabs.sendMessage(tabId, { action: 'pageAdvisorWaterfall', run: payload });
      if (sentTab && typeof sentTab.catch === 'function') sentTab.catch(() => {});
    } catch (_) { /* content script may be gone */ }
  }
}

  function bindPageAdvisorWithSpan(run) {
  if (!run || typeof PageAdvisorTiming === 'undefined') {
    return async function passthrough(_id, fn) { return fn(); };
  }
  return async function timed(id, fn) {
    try {
      // onStart：细项一进入 running 即广播，侧栏可先显示行再更新耗时
      const value = await PageAdvisorTiming.withSpan(run, id, () => Date.now(), fn, {
        onStart: () => broadcastPageAdvisorWaterfall(run),
      });
      broadcastPageAdvisorWaterfall(run);
      return value;
    } catch (err) {
      broadcastPageAdvisorWaterfall(run);
      throw err;
    }
  };
}

function finishPageAdvisorTiming(run, ok, traceId) {
  if (!run || typeof PageAdvisorTiming === 'undefined') return;
  if (ok) PageAdvisorTiming.completeRun(run, () => Date.now());
  else PageAdvisorTiming.failRun(run, () => Date.now(), traceId || '');
  broadcastPageAdvisorWaterfall(run);
  persistPageAdvisorWaterfallHistory(run);
}

function beginPageAdvisorTimingRun(route, command) {
  if (typeof PageAdvisorTiming === 'undefined') return null;
  const run = PageAdvisorTiming.createRun({
    runId: newPageAdvisorRunId(),
    command,
    route,
    now: () => Date.now(),
  });
  if (typeof PageAdvisorTiming.seedPlannedSpans === 'function') {
    PageAdvisorTiming.seedPlannedSpans(run);
  }
  broadcastPageAdvisorWaterfall(run);
  return run;
}

async function notifyPageAdvisorDone(tabId, payload, withSpan, timingRun) {
  const body = Object.assign({}, payload, {
    waterfallRunId: timingRun && timingRun.runId,
  });
  await withSpan('render', () => notifyContentPageAdvisor(tabId, body));
  finishPageAdvisorTiming(timingRun, true, payload.traceId || '');
}

function wrapBuiltinAdvisorNotify(notify, withSpan, timingRun) {
  return async function timedNotify(tabId, payload) {
    if (payload && payload.ok && payload.phase === 'done') {
      return notifyPageAdvisorDone(tabId, payload, withSpan, timingRun);
    }
    if (payload && payload.ok === false) {
      finishPageAdvisorTiming(timingRun, false, payload.traceId || '');
    }
    return notify(tabId, payload);
  };
}
