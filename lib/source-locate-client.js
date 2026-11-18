/**
 * Content-side source-locate client (dependency-injected, testable).
 * Collects page resources, builds batched requests, enriches suggestions.
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const MAX_RESOURCES = 24;
  const MAX_ADVISOR_ITEMS = 20;
  const ADVISOR_TIMEOUT_MS = 3000;
  const ELEMENT_TIMEOUT_MS = 6000;

  function collectResourceUrls(doc, perf) {
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d || typeof d.querySelectorAll !== 'function') return [];
    const urls = [];
    const add = (raw) => {
      if (!raw) return;
      try {
        const u = new URL(String(raw), d.baseURI || undefined);
        if (u.protocol === 'http:' || u.protocol === 'https:') urls.push(u.href);
      } catch (_) { /* ignore */ }
    };
    try {
      const scripts = d.querySelectorAll('script[src]');
      Array.from(scripts).forEach((el) => add(el.src || (el.getAttribute && el.getAttribute('src'))));
    } catch (_) { /* ignore */ }
    try {
      const links = d.querySelectorAll('link[rel="modulepreload"][href], link[rel="stylesheet"][href]');
      Array.from(links).forEach((el) => add(el.href || (el.getAttribute && el.getAttribute('href'))));
    } catch (_) { /* ignore */ }
    try {
      const p = perf || (typeof performance !== 'undefined' ? performance : null);
      if (p && typeof p.getEntriesByType === 'function') {
        p.getEntriesByType('resource').forEach((entry) => {
          if (entry && (entry.initiatorType === 'script' || entry.initiatorType === 'link')) {
            add(entry.name);
          }
        });
      }
    } catch (_) { /* ignore */ }
    const out = [];
    const seen = new Set();
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
      if (out.length >= MAX_RESOURCES) break;
    }
    return out;
  }

  function makeRunId(prefix) {
    const p = String(prefix || 'req').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'req';
    return `sl-${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function request(message, deps) {
    const runId = String(message.runId || makeRunId('req'));
    const payload = {
      action: 'sourceLocate',
      runId,
      pageUrl: String(message.pageUrl || ''),
      resources: Array.isArray(message.resources) ? message.resources : [],
      items: Array.isArray(message.items) ? message.items : [],
      mode: message.mode === 'advisor' ? 'advisor' : 'element',
      timeoutMs: Number(message.timeoutMs) || 0,
    };
    try {
      const res = await deps.sendMessage(payload, Number(message.timeoutMs) || 0);
      if (!res || typeof res !== 'object') return { ok: false, runId, error: 'fetch-failed' };
      return { ...res, runId: res.runId || runId };
    } catch (_) {
      try {
        await deps.sendMessage({ action: 'sourceLocateCancel', runId }, 1000);
      } catch (_) { /* ignore */ }
      return { ok: false, runId, error: 'timeout' };
    }
  }

  async function cancel(runId, deps) {
    if (!runId) return { ok: true, cancelled: false };
    try {
      return await deps.sendMessage({ action: 'sourceLocateCancel', runId }, 1000);
    } catch (_) {
      return { ok: false, cancelled: false };
    }
  }

  async function locateEvidence(evidenceList, deps, runId) {
    const list = Array.isArray(evidenceList) ? evidenceList : [];
    const items = [];
    list.forEach((evidence, index) => {
      if (Array.isArray(evidence) && evidence.length) {
        items.push({ id: `e${index}`, evidence });
      }
    });
    if (!items.length) return { ok: false, runId: runId || '', error: 'invalid' };
    const resources = typeof deps.collectResources === 'function' ? deps.collectResources() : [];
    return request({
      runId,
      pageUrl: deps.pageUrl,
      resources,
      items,
      mode: 'element',
      timeoutMs: ELEMENT_TIMEOUT_MS,
    }, deps);
  }

  async function enrichSuggestions(suggestions, deps) {
    const list = Array.isArray(suggestions) ? suggestions : [];
    const items = [];
    for (const suggestion of list.slice(0, MAX_ADVISOR_ITEMS)) {
      if (!suggestion || suggestion.id == null) continue;
      const evidence = typeof deps.evidenceFromSuggestion === 'function'
        ? deps.evidenceFromSuggestion(suggestion)
        : [];
      if (Array.isArray(evidence) && evidence.length) {
        items.push({ id: String(suggestion.id), evidence });
      }
    }
    if (!items.length) return list;
    const resources = typeof deps.collectResources === 'function' ? deps.collectResources() : [];
    const res = await request({
      pageUrl: deps.pageUrl,
      resources,
      items,
      mode: 'advisor',
      timeoutMs: ADVISOR_TIMEOUT_MS,
    }, deps);
    if (!res || !res.ok || !Array.isArray(res.results)) return list;
    const byId = new Map(res.results.map((r) => [String(r.id), r]));
    return list.map((suggestion) => {
      const loc = suggestion && suggestion.id != null ? byId.get(String(suggestion.id)) : null;
      if (!loc || (loc.confidence !== 'high' && loc.confidence !== 'medium')) return suggestion;
      return {
        ...suggestion,
        source_file: loc.file,
        source_line: loc.line,
        source_confidence: loc.confidence,
      };
    });
  }

  async function isAdvisorEnabled(deps) {
    try {
      const result = await deps.storageGet(['pageAdvisorSourceLocate']);
      return !!(result && result.pageAdvisorSourceLocate);
    } catch (_) {
      return false;
    }
  }

  async function setAdvisorEnabled(enabled, deps) {
    try {
      await deps.storageSet({ pageAdvisorSourceLocate: !!enabled });
      return true;
    } catch (_) {
      return false;
    }
  }

  const SourceLocateClient = {
    MAX_RESOURCES,
    MAX_ADVISOR_ITEMS,
    ADVISOR_TIMEOUT_MS,
    ELEMENT_TIMEOUT_MS,
    collectResourceUrls,
    makeRunId,
    request,
    cancel,
    locateEvidence,
    enrichSuggestions,
    isAdvisorEnabled,
    setAdvisorEnabled,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceLocateClient;
  }
  global.SourceLocateClient = SourceLocateClient;
}(typeof globalThis !== 'undefined' ? globalThis : this));
}
