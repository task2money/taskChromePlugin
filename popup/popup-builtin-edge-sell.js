/**
 * Popup: register this Chrome to a sell project + start outbound tunnel keepalive (ADR-0130).
 */
(function () {
  'use strict';

  const Tunnel = globalThis.BuiltinEdgeTunnel;
  const Join = globalThis.BuiltinEdgeNodeJoin;

  function tx(key, fallback) {
    try {
      if (globalThis.AidevpushI18n?.t) return AidevpushI18n.t(key) || fallback;
    } catch (_) { /* ignore */ }
    return fallback;
  }

  function newIdem(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function saasRequest(method, path, body, extraHeaders) {
    const base = API.getBaseUrl();
    const token = API.getToken();
    if (!base || !token) throw new Error(tx('builtinEdgeNeedLogin', '请先登录'));
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `plugin-${Date.now()}`,
      ...(extraHeaders || {}),
    };
    const auth = API.buildAuthorizationHeader(token);
    if (auth) headers.Authorization = auth;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body != null && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (res.status === 204) return {};
    return res.json();
  }

  async function tunnelFetch(action, body) {
    const base = API.getBaseUrl();
    const token = API.getToken();
    const headers = {
      'Content-Type': 'application/json',
      'X-Trace-Id': `tunnel-${Date.now()}`,
    };
    const auth = API.buildAuthorizationHeader(token);
    if (auth) headers.Authorization = auth;
    const res = await fetch(`${base}/api/ai-endpoint/v1/builtin-edge/tunnel/${action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `tunnel ${action} ${res.status}`);
    }
    return res.json();
  }

  async function refreshStatusEl() {
    const el = document.getElementById('builtinEdgeSellStatus');
    if (!el || !Tunnel) return;
    const active = await Tunnel.getActiveBuiltinEdgeTunnel();
    if (!active?.nodeId) {
      el.textContent = tx('builtinEdgeSellIdle', '尚未注册到出售项目');
      return;
    }
    el.textContent = tx('builtinEdgeSellOnline', '已注册') +
      ` · project ${active.projectId} · node ${active.nodeId}`;
  }

  async function onRegister() {
    const input = document.getElementById('builtinEdgeProjectId');
    const labelInput = document.getElementById('builtinEdgeDeviceLabel');
    const status = document.getElementById('builtinEdgeSellStatus');
    const projectId = String(input?.value || '').trim();
    if (!projectId) {
      if (status) status.textContent = tx('builtinEdgeNeedProjectId', '请填写出售项目 ID');
      return;
    }
    if (!Tunnel || !Join) {
      if (status) status.textContent = 'BuiltinEdgeTunnel missing';
      return;
    }
    if (status) status.textContent = tx('builtinEdgeRegistering', '正在注册…');
    try {
      const out = await Tunnel.registerPluginToSellProject({
        projectId,
        deviceLabel: String(labelInput?.value || '').trim(),
        apiRequest: (method, path, body) => saasRequest(method, path, body, {
          'Idempotency-Key': newIdem('edge-node'),
        }),
      });
      await Tunnel.setActiveBuiltinEdgeTunnel({
        projectId: out.projectId,
        nodeId: out.nodeId,
        deviceLabel: out.deviceLabel,
      });
      try {
        await chrome.runtime.sendMessage({
          action: 'startBuiltinEdgeTunnel',
          projectId: out.projectId,
          nodeId: out.nodeId,
        });
      } catch (_) { /* SW may still pick from storage */ }
      await refreshStatusEl();
    } catch (e) {
      if (status) status.textContent = e?.message || String(e);
    }
  }

  function bind() {
    const section = document.getElementById('builtinEdgeSellSection');
    if (!section) return;
    const btn = document.getElementById('btnBuiltinEdgeRegister');
    // Anti-Replay-OK: createClickGuard if available
    const guard = globalThis.ClickGuard?.createClickGuard
      ? ClickGuard.createClickGuard()
      : null;
    btn?.addEventListener('click', () => {
      if (guard) guard.run(onRegister);
      else onRegister();
    });
    refreshStatusEl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
