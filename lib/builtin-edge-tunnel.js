/**
 * Builtin edge sell: register plugin to sell project + outbound tunnel keepalive (ADR-0130).
 * Depends on BuiltinEdgeNodeJoin (load node-join.js first in classic scripts).
 * Secret-Hardcode-OK: local storage keys only.
 */
(function (root) {
  'use strict';

  const TUNNEL_ALARM = 'builtinEdgeTunnelKeepalive';
  const STORAGE_ACTIVE = 'builtinEdgeActiveTunnel';
  const Join = root.BuiltinEdgeNodeJoin;

  async function resolveSupportedModels(opts) {
    if (Array.isArray(opts?.supportedModels)) {
      return opts.supportedModels.map((m) => String(m || '').trim()).filter(Boolean);
    }
    const probe = root.BuiltinEdgeSupportedModels?.probeBuiltinEdgeSupportedModels;
    if (typeof probe !== 'function') return [];
    const lm = opts?.languageModel != null ? opts.languageModel : root.LanguageModel;
    const builtinPrompt = opts?.builtinPrompt || root.PageAdvisorBuiltinPrompt;
    const locale = opts?.locale || 'zh-CN';
    try {
      return await probe(lm, builtinPrompt, locale);
    } catch (_) {
      return [];
    }
  }

  async function registerPluginToSellProject(opts) {
    const projectId = String(opts?.projectId || '').trim();
    if (!projectId) throw new Error('projectId required');
    if (typeof opts.apiRequest !== 'function') throw new Error('apiRequest required');
    if (!Join?.saveBuiltinEdgeNodeJoin) throw new Error('BuiltinEdgeNodeJoin missing');
    const label = String(opts.deviceLabel || '').trim() || 'chrome-plugin';
    const FP = root.PluginInstallFingerprint;
    let fingerprint = String(opts.installFingerprint || '').trim();
    if (!fingerprint && FP?.ensurePluginInstallFingerprint) {
      fingerprint = await FP.ensurePluginInstallFingerprint(opts.storage || chrome.storage?.local);
    }
    if (!fingerprint) throw new Error('install_fingerprint required');
    const supportedModels = await resolveSupportedModels(opts);
    const node = await opts.apiRequest(
      'POST',
      `/api/cloud/v1/builtin-edge/offers/${encodeURIComponent(projectId)}/nodes`,
      { device_label: label, install_fingerprint: fingerprint, supported_models: supportedModels },
    );
    const nodeId = String(node?.id || '').trim();
    if (!nodeId) throw new Error('node id missing from register response');
    await Join.saveBuiltinEdgeNodeJoin({
      offer_id: projectId,
      node_id: nodeId,
      device_label: label,
      install_fingerprint: fingerprint,
    }, opts.storage);
    return { projectId, nodeId, deviceLabel: label, installFingerprint: fingerprint };
  }

  async function runBuiltinEdgeKeepaliveRound(opts) {
    const projectId = String(opts.projectId || '').trim();
    const nodeId = String(opts.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('projectId and nodeId required');
    const supportedModels = await resolveSupportedModels(opts);
    await opts.apiRequest(
      'POST',
      `/api/cloud/v1/builtin-edge/nodes/${encodeURIComponent(nodeId)}/heartbeat`,
      { online: true, supported_models: supportedModels },
    );
    await opts.tunnelFetch('register', { offer_id: projectId, node_id: nodeId });
    const polled = await opts.tunnelFetch('poll', { node_id: nodeId });
    return { polled: polled?.job || null };
  }

  /**
   * Run LanguageModel for a polled tunnel job (ADR-0130 T5).
   * deps.languageModel — globalThis.LanguageModel (injectable in tests)
   * deps.builtinPrompt — PageAdvisorBuiltinPrompt (injectable)
   * deps.locale — UI locale for language options
   */
  async function executeBuiltinEdgeTunnelJob(job, deps) {
    const promptApi = deps?.builtinPrompt || (typeof PageAdvisorBuiltinPrompt !== 'undefined' ? PageAdvisorBuiltinPrompt : null);
    const lm = deps?.languageModel;
    const locale = deps?.locale || 'zh-CN';
    const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
    let prompt = String(payload.prompt || '').trim();
    if (!prompt && Array.isArray(payload.messages)) {
      prompt = payload.messages
        .map((m) => String(m?.content || '').trim())
        .filter(Boolean)
        .join('\n');
    }
    if (!prompt) {
      return { ok: false, error: 'empty_prompt', result: null };
    }
    if (!lm || !promptApi || typeof promptApi.run !== 'function') {
      return { ok: false, error: 'language_model_unavailable', result: null };
    }
    try {
      const out = await promptApi.run(lm, locale, prompt);
      if (out?.availability && out.availability !== 'available') {
        return {
          ok: false,
          error: `language_model_${out.availability}`,
          result: { availability: out.availability },
        };
      }
      return {
        ok: true,
        error: '',
        result: {
          content: String(out?.result || ''),
          availability: out?.availability || 'available',
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: String(e?.message || e || 'inference_failed'),
        result: null,
      };
    }
  }

  async function setActiveBuiltinEdgeTunnel(row, storage) {
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.set) throw new Error('storage unavailable');
    await new Promise((resolve, reject) => {
      store.set({ [STORAGE_ACTIVE]: row }, () => {
        const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async function getActiveBuiltinEdgeTunnel(storage) {
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.get) return null;
    return new Promise((resolve) => {
      store.get([STORAGE_ACTIVE], (r) => resolve(r?.[STORAGE_ACTIVE] || null));
    });
  }

  async function clearActiveBuiltinEdgeTunnel(storage) {
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.remove && !store?.set) throw new Error('storage unavailable');
    if (store.remove) {
      await new Promise((resolve, reject) => {
        store.remove([STORAGE_ACTIVE], () => {
          const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    }
    await new Promise((resolve, reject) => {
      store.set({ [STORAGE_ACTIVE]: null }, () => {
        const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const api = {
    TUNNEL_ALARM,
    STORAGE_ACTIVE,
    registerPluginToSellProject,
    runBuiltinEdgeKeepaliveRound,
    executeBuiltinEdgeTunnelJob,
    setActiveBuiltinEdgeTunnel,
    getActiveBuiltinEdgeTunnel,
    clearActiveBuiltinEdgeTunnel,
  };
  root.BuiltinEdgeTunnel = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
