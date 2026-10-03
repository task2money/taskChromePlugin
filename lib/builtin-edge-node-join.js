/**
 * Builtin edge sell: persist node join payload for SW heartbeat (ADR-0129/0130).
 * Secret-Hardcode-OK: local storage keys only, no credentials.
 */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'builtinEdgeOfferNodes';

  /**
   * @param {{ offer_id: string, node_id: string, device_label?: string, install_fingerprint?: string }} payload
   * @param {{ get?: Function, set?: Function }} [storage] chrome.storage.local-like
   */
  async function saveBuiltinEdgeNodeJoin(payload, storage) {
    const offerId = String(payload?.offer_id || '').trim();
    const nodeId = String(payload?.node_id || '').trim();
    if (!offerId || !nodeId) {
      throw new Error('offer_id and node_id required');
    }
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.get || !store?.set) {
      throw new Error('storage unavailable');
    }
    const cur = await new Promise((resolve) => {
      store.get([STORAGE_KEY], (r) => resolve(r?.[STORAGE_KEY] || {}));
    });
    const next = { ...(cur && typeof cur === 'object' ? cur : {}) };
    next[offerId] = {
      node_id: nodeId,
      device_label: String(payload.device_label || ''),
      install_fingerprint: String(payload.install_fingerprint || ''),
      updated_at: new Date().toISOString(),
    };
    await new Promise((resolve, reject) => {
      store.set({ [STORAGE_KEY]: next }, () => {
        const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (err) reject(err);
        else resolve();
      });
    });
    return next[offerId];
  }

  async function loadBuiltinEdgeNodeJoin(offerId, storage) {
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.get) return null;
    const cur = await new Promise((resolve) => {
      store.get([STORAGE_KEY], (r) => resolve(r?.[STORAGE_KEY] || {}));
    });
    const row = cur?.[offerId];
    return row && row.node_id ? row : null;
  }

  async function clearBuiltinEdgeNodeJoin(offerId, storage) {
    const id = String(offerId || '').trim();
    if (!id) return;
    const store = storage || (typeof chrome !== 'undefined' ? chrome.storage?.local : null);
    if (!store?.get || !store?.set) return;
    const cur = await new Promise((resolve) => {
      store.get([STORAGE_KEY], (r) => resolve(r?.[STORAGE_KEY] || {}));
    });
    const next = { ...(cur && typeof cur === 'object' ? cur : {}) };
    delete next[id];
    await new Promise((resolve, reject) => {
      store.set({ [STORAGE_KEY]: next }, () => {
        const err = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const api = {
    STORAGE_KEY,
    saveBuiltinEdgeNodeJoin,
    loadBuiltinEdgeNodeJoin,
    clearBuiltinEdgeNodeJoin,
  };
  root.BuiltinEdgeNodeJoin = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
