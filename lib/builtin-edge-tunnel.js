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

  async function registerPluginToSellProject(opts) {
    const projectId = String(opts?.projectId || '').trim();
    if (!projectId) throw new Error('projectId required');
    if (typeof opts.apiRequest !== 'function') throw new Error('apiRequest required');
    if (!Join?.saveBuiltinEdgeNodeJoin) throw new Error('BuiltinEdgeNodeJoin missing');
    const label = String(opts.deviceLabel || '').trim() || 'chrome-plugin';
    const node = await opts.apiRequest(
      'POST',
      `/api/cloud/v1/builtin-edge/offers/${encodeURIComponent(projectId)}/nodes`,
      { device_label: label },
    );
    const nodeId = String(node?.id || '').trim();
    if (!nodeId) throw new Error('node id missing from register response');
    await Join.saveBuiltinEdgeNodeJoin({
      offer_id: projectId,
      node_id: nodeId,
      device_label: label,
    }, opts.storage);
    return { projectId, nodeId, deviceLabel: label };
  }

  async function runBuiltinEdgeKeepaliveRound(opts) {
    const projectId = String(opts.projectId || '').trim();
    const nodeId = String(opts.nodeId || '').trim();
    if (!projectId || !nodeId) throw new Error('projectId and nodeId required');
    await opts.apiRequest(
      'POST',
      `/api/cloud/v1/builtin-edge/nodes/${encodeURIComponent(nodeId)}/heartbeat`,
      { online: true },
    );
    await opts.tunnelFetch('register', { offer_id: projectId, node_id: nodeId });
    const polled = await opts.tunnelFetch('poll', { node_id: nodeId });
    return { polled: polled?.job || null };
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

  const api = {
    TUNNEL_ALARM,
    STORAGE_ACTIVE,
    registerPluginToSellProject,
    runBuiltinEdgeKeepaliveRound,
    setActiveBuiltinEdgeTunnel,
    getActiveBuiltinEdgeTunnel,
  };
  root.BuiltinEdgeTunnel = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
