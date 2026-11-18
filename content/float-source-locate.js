/**
 * Source-locate UI wiring: Alt+X adjust modal + Alt+Z toolbar toggle.
 * Fetches and parsing happen in the service worker; this file only handles DOM.
 */

'use strict';

if (!globalThis.__taskpluginContentBoot?.skip) {
var FloatSourceLocate = (function () {
  var currentSnapshot = null;

  function txOr(key, fallback, params) {
    if (typeof tx === 'function') {
      var value = tx(key, params);
      if (value != null && value !== key) return value;
    }
    if (!params) return fallback;
    return String(fallback).replace(/\{(\w+)\}/g, function (_, name) {
      return params[name] != null ? String(params[name]) : '{' + name + '}';
    });
  }

  function storageGet(keys) {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(keys, function (result) { resolve(result || {}); });
      } catch (_) {
        resolve({});
      }
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.storage.local.set(obj, function () { resolve(true); });
      } catch (err) {
        reject(err);
      }
    });
  }

  function deps() {
    return {
      pageUrl: location.href,
      collectResources: function () {
        return SourceLocateClient.collectResourceUrls(document);
      },
      evidenceFromSuggestion: function (suggestion) {
        return SourceLocateEvidence.evidenceFromSuggestion(suggestion);
      },
      sendMessage: function (message, timeoutMs) {
        return sendMessageWithTimeout(message, timeoutMs || 8000);
      },
      storageGet: storageGet,
      storageSet: storageSet,
    };
  }

  function setStatus(text, kind) {
    var el = document.getElementById('taskplugin-adjust-locate-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'taskplugin-source-locate-status'
      + (text ? ' taskplugin-show' : '')
      + (kind ? ' taskplugin-source-locate-status-' + kind : '');
  }

  function setInclude(enabled, checked) {
    var box = document.getElementById('taskplugin-adjust-locate-include');
    if (!box) return;
    box.disabled = !enabled;
    box.checked = !!checked;
  }

  function setButtonDisabled(disabled) {
    var btn = document.getElementById('taskplugin-adjust-locate');
    if (btn) btn.disabled = !!disabled;
  }

  function evidenceFor(elements) {
    if (typeof SourceLocateEvidence === 'undefined') return [];
    return SourceLocateEvidence.collectForElements(elements);
  }

  function mapResults(results, count) {
    var out = new Array(count);
    (results || []).forEach(function (result) {
      var match = /^e(\d+)$/.exec(String(result && result.id || ''));
      if (match) out[Number(match[1])] = result;
    });
    return out;
  }

  function bestLabel(results) {
    var format = typeof SourceLocateFormat !== 'undefined' ? SourceLocateFormat : null;
    var writable = (results || []).filter(function (r) {
      return format ? format.isWritable(r.confidence) : (r.confidence === 'high' || r.confidence === 'medium');
    });
    if (!writable.length) return '';
    var first = writable[0];
    var label = first.file + ':' + first.line;
    var conf = format ? format.confidenceLabel(first.confidence) : first.confidence;
    return label + '（' + conf + '）';
  }

  function reset(snapshot) {
    setStatus('');
    setInclude(false, false);
    setButtonDisabled(false);
    if (snapshot && (snapshot.inIframe || snapshot.crossOriginIframe)) {
      setButtonDisabled(true);
      setStatus(txOr('sourceLocateIframeUnsupported', 'iframe 内暂不支持源码定位（V1）'), 'error');
    }
  }

  async function runForSnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.inIframe || snapshot.crossOriginIframe) {
      setStatus(txOr('sourceLocateIframeUnsupported', 'iframe 内暂不支持源码定位（V1）'), 'error');
      setButtonDisabled(true);
      return;
    }
    if (snapshot._sourceRunId) return;
    var evidence = Array.isArray(snapshot._sourceEvidence) ? snapshot._sourceEvidence : [];
    if (!evidence.length) {
      setStatus(txOr('sourceLocateNone', '本页未发现可用 source map'), 'error');
      setInclude(false, false);
      return;
    }

    currentSnapshot = snapshot;
    var runId = SourceLocateClient.makeRunId('adj');
    snapshot._sourceRunId = runId;
    setButtonDisabled(true);
    setInclude(false, false);
    setStatus(txOr('sourceLocateRunning', '正在读取脚本与 source map…'), '');

    var res;
    try {
      res = await SourceLocateClient.locateEvidence(evidence, deps(), runId);
    } finally {
      if (snapshot === currentSnapshot) {
        snapshot._sourceRunId = '';
        setButtonDisabled(false);
      }
    }
    if (snapshot !== currentSnapshot) return;
    if (!res || !res.ok) {
      var errorKey = res && res.error === 'timeout' ? 'sourceLocateTimeout' : 'sourceLocateNone';
      var fallback = res && res.error === 'timeout' ? '源码定位超时，已跳过' : '本页未发现可用 source map';
      setStatus(txOr(errorKey, fallback), 'error');
      setInclude(false, false);
      return;
    }

    var locations = mapResults(res.results || [], evidence.length);
    snapshot._sourceLocations = locations;
    var writable = locations.filter(function (r) {
      return r && (r.confidence === 'high' || r.confidence === 'medium');
    });
    if (!writable.length) {
      setStatus(txOr('sourceLocateNoConfidence', '已找到候选，但置信度不足'), 'error');
      setInclude(false, false);
      return;
    }
    setInclude(true, true);
    if (writable.length > 1) {
      setStatus(txOr('sourceLocateMultiFound', '已定位 {found}/{total}', {
        found: writable.length,
        total: locations.filter(Boolean).length,
      }), 'ok');
    } else {
      setStatus(bestLabel(locations), 'ok');
    }
  }

  function cancelForSnapshot(snapshot) {
    if (!snapshot || !snapshot._sourceRunId) return;
    var runId = snapshot._sourceRunId;
    snapshot._sourceRunId = '';
    try {
      SourceLocateClient.cancel(runId, deps());
    } catch (_) { /* ignore */ }
  }

  function onModalOpen(snapshot) {
    currentSnapshot = snapshot || null;
    reset(snapshot);
  }

  function onModalClose(snapshot) {
    cancelForSnapshot(snapshot || currentSnapshot);
    currentSnapshot = null;
    setStatus('');
    setInclude(false, false);
    setButtonDisabled(false);
  }

  function setAdvisorStatus(text) {
    var el = document.getElementById('taskplugin-page-advisor-source-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'taskplugin-page-advisor-source-status' + (text ? ' taskplugin-show' : '');
  }

  async function enrichAdvisorSuggestions(suggestions) {
    var enabled = await SourceLocateClient.isAdvisorEnabled(deps());
    if (!enabled) return suggestions;
    setAdvisorStatus(txOr('paSourceLocateRunning', '定位源码中…（最多 3 秒）'));
    try {
      return await SourceLocateClient.enrichSuggestions(suggestions, deps());
    } finally {
      setAdvisorStatus('');
    }
  }

  function bindAdvisorToggle() {
    var box = document.getElementById('taskplugin-page-advisor-source-locate');
    if (!box || box.dataset.sourceLocateBound === '1') return;
    box.dataset.sourceLocateBound = '1';
    SourceLocateClient.isAdvisorEnabled(deps()).then(function (enabled) {
      box.checked = !!enabled;
    }).catch(function () { /* ignore */ });
    box.addEventListener('change', function () {
      SourceLocateClient.setAdvisorEnabled(!!box.checked, deps()).catch(function () { /* ignore */ });
    });
  }

  function bindAdjustButton() {
    var btn = document.getElementById('taskplugin-adjust-locate');
    if (!btn || btn.dataset.sourceLocateBound === '1') return;
    btn.dataset.sourceLocateBound = '1';
    btn.addEventListener('click', function () {
      void runForSnapshot(typeof pendingElementSnapshot !== 'undefined' ? pendingElementSnapshot : null);
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        bindAdjustButton();
        bindAdvisorToggle();
      }, { once: true });
    } else {
      bindAdjustButton();
      bindAdvisorToggle();
    }
  }

  return {
    evidenceFor: evidenceFor,
    runForSnapshot: runForSnapshot,
    cancelForSnapshot: cancelForSnapshot,
    onModalOpen: onModalOpen,
    onModalClose: onModalClose,
    enrichAdvisorSuggestions: enrichAdvisorSuggestions,
    bindAdvisorToggle: bindAdvisorToggle,
    bindAdjustButton: bindAdjustButton,
  };
}());

if (typeof globalThis !== 'undefined') {
  globalThis.FloatSourceLocate = FloatSourceLocate;
}
}
