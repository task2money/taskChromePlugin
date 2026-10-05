'use strict';

/**
 * OPT-20261005-005: 记录本机模型（route=builtin）最近一次成功运行的耗时，
 * 用于把「本机模型」选项标题里的静态「约130s」替换为本机实测值。
 * 纯函数 + storage 注入，便于单测；无实测数据时回退静态文案。
 */
const PageAdvisorBuiltinLastRun = (() => {
  const BUILTIN_LAST_MS_KEY = 'paBuiltinLastMs';

  function extractBuiltinRunMs(run) {
    if (!run || typeof run !== 'object') return 0;
    if (String(run.route || '') !== 'builtin') return 0;
    if (String(run.status || '') !== 'ok') return 0;
    const startedAt = Number(run.startedAt);
    const endedAt = Number(run.endedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
    const ms = Math.round(endedAt - startedAt);
    return ms > 0 ? ms : 0;
  }

  /** 记录成功运行耗时；非 builtin / 非成功 / 非法耗时一律忽略。 */
  async function recordBuiltinRun(storage, run) {
    const ms = extractBuiltinRunMs(run);
    if (!ms) return 0;
    if (storage && typeof storage.set === 'function') {
      try {
        await storage.set({ [BUILTIN_LAST_MS_KEY]: ms });
      } catch (_) { /* ignore storage errors */ }
    }
    return ms;
  }

  async function readBuiltinLastMs(storage) {
    if (!storage || typeof storage.get !== 'function') return 0;
    try {
      const got = await storage.get([BUILTIN_LAST_MS_KEY]);
      const ms = Number(got && got[BUILTIN_LAST_MS_KEY]);
      return Number.isFinite(ms) && ms > 0 ? ms : 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * 渲染「本机模型」标题：有实测耗时用 paLlmRouteBuiltinMeasured（{sec} 占位），
   * 否则回退静态 paLlmRouteBuiltin。
   */
  function builtinRouteLabel(tx, lastMs) {
    const t = typeof tx === 'function' ? tx : (k) => k;
    const staticLabel = t('paLlmRouteBuiltin');
    const ms = Number(lastMs);
    if (!Number.isFinite(ms) || ms <= 0) return staticLabel;
    const tpl = t('paLlmRouteBuiltinMeasured');
    if (!tpl || tpl === 'paLlmRouteBuiltinMeasured' || tpl.indexOf('{sec}') === -1) {
      return staticLabel;
    }
    const sec = Math.max(1, Math.round(ms / 1000));
    return tpl.replace('{sec}', String(sec));
  }

  return { BUILTIN_LAST_MS_KEY, extractBuiltinRunMs, recordBuiltinRun, readBuiltinLastMs, builtinRouteLabel };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PageAdvisorBuiltinLastRun;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PageAdvisorBuiltinLastRun = PageAdvisorBuiltinLastRun;
}
