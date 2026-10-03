/**
 * 本机模型出售：插件重装后从服务端节点列表恢复本地注册（无 HTTP）。
 * Secret-Hardcode-OK: 无凭据。
 */
(function (root) {
  'use strict';

  function isLiveEdgeNode(node) {
    const id = String(node?.id || '').trim();
    const status = String(node?.status || '').trim().toLowerCase();
    return Boolean(id) && status !== 'revoked';
  }

  function seenRank(node) {
    const raw = String(node?.last_seen_at || node?.updated_at || '').trim();
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  }

  function pickLatest(nodes) {
    return nodes.slice().sort((a, b) => seenRank(b) - seenRank(a) || String(a.id).localeCompare(String(b.id)))[0] || null;
  }

  /**
   * @param {string} fingerprint
   * @param {Array<{id?:string,offer_id?:string,status?:string,install_fingerprint?:string}>|null|undefined} nodes
   */
  function pickRecoverableBuiltinEdgeNode(fingerprint, nodes) {
    const live = (Array.isArray(nodes) ? nodes : []).filter(isLiveEdgeNode);
    const fp = String(fingerprint || '').trim();
    if (fp) {
      const matched = live.filter((n) => String(n.install_fingerprint || '').trim() === fp);
      if (matched.length === 1) return matched[0];
      if (matched.length > 1) return pickLatest(matched);
    }
    if (live.length === 1) return live[0];
    return null;
  }

  function toActiveTunnelRow(node) {
    return {
      projectId: String(node?.offer_id || '').trim(),
      nodeId: String(node?.id || '').trim(),
      deviceLabel: String(node?.device_label || '').trim(),
      installFingerprint: String(node?.install_fingerprint || '').trim(),
    };
  }

  const api = {
    pickRecoverableBuiltinEdgeNode,
    toActiveTunnelRow,
  };
  root.BuiltinEdgeRegistrationRecover = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
