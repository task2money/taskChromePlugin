/**
 * 内置模型启用等待 / 偏死恢复（F-141）。
 * 不调用 LanguageModel.create（快捷键不得当下载手势）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PageAdvisorBuiltinEnable = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageAdvisorBuiltinEnableFactory() {
  async function waitIfEnabling(languageModel, locale, tabId, deps) {
    const Runtime = typeof PageAdvisorBuiltinRuntime !== 'undefined' ? PageAdvisorBuiltinRuntime : null;
    if (!Runtime || typeof Runtime.read !== 'function') return;
    const timeoutMs = Number(deps && deps.enableTimeoutMs);
    const pollMs = Number(deps && deps.enablePollMs);
    const poll = Number.isFinite(pollMs) && pollMs >= 0 ? pollMs : 400;
    const limit = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : (Runtime.ENABLE_STALE_MS || 180000);
    let snap = await Runtime.read();
    if (!snap || !snap.downloadInFlight) return;
    if (typeof Runtime.recoverIfStale === 'function') {
      const rec = await Runtime.recoverIfStale(undefined, Date.now(), limit);
      if (rec && rec.recovered) return;
    }
    const tx = deps && typeof deps.tx === 'function' ? deps.tx : (key) => key;
    const probeFn = deps && typeof deps.probe === 'function' ? deps.probe : null;
    const deadline = Date.now() + limit;
    while (Date.now() < deadline) {
      snap = await Runtime.read();
      if (!snap || !snap.downloadInFlight) return;
      if (Runtime.isEnableStale && Runtime.isEnableStale(snap, Date.now(), limit)) {
        await Runtime.recoverIfStale(undefined, Date.now(), limit);
        return;
      }
      let av = '';
      if (probeFn) {
        try { av = await probeFn(languageModel, locale); } catch (_) { av = ''; }
      }
      if (av === 'available') return;
      const pct = snap.downloadPct != null ? String(snap.downloadPct) : '100';
      const sec = Runtime.enableWaitedSec ? String(Runtime.enableWaitedSec(snap)) : '0';
      if (deps && typeof deps.notify === 'function') {
        await deps.notify(tabId, {
          ok: true,
          phase: 'loading',
          message: tx('paBuiltinEnablingWait', { pct, sec }),
        });
      }
      if (poll === 0) break;
      await new Promise((resolve) => setTimeout(resolve, poll));
    }
    if (typeof Runtime.recoverIfStale === 'function') {
      await Runtime.recoverIfStale(undefined, Date.now() + limit, limit);
    }
  }

  return { waitIfEnabling };
});
