/**
 * SW: outbound tunnel keepalive for builtin-edge sell (ADR-0130).
 * Uses chrome.alarms — requires "alarms" permission.
 */
(function () {
  'use strict';

  const Tunnel = globalThis.BuiltinEdgeTunnel;
  const ALARM = Tunnel?.TUNNEL_ALARM || 'builtinEdgeTunnelKeepalive';

  function buildAuthHeaders() {
    const token = typeof API !== 'undefined' ? API.getToken() : '';
    const headers = { 'Content-Type': 'application/json', 'X-Trace-Id': `edge-hb-${Date.now()}` };
    if (typeof API !== 'undefined' && token) {
      const auth = API.buildAuthorizationHeader(token);
      if (auth) headers.Authorization = auth;
    }
    return headers;
  }

  async function saasRequest(method, path, body) {
    const base = API.getBaseUrl();
    if (!base) throw new Error('baseUrl missing');
    const headers = buildAuthHeaders();
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Idempotency-Key'] = `edge-hb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body != null && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (_) {
      return {};
    }
  }

  async function tunnelFetch(action, body) {
    const base = API.getBaseUrl();
    const res = await fetch(`${base}/api/ai-endpoint/v1/builtin-edge/tunnel/${action}`, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `tunnel ${action} ${res.status}`);
    }
    return res.json();
  }

  async function ensureSessionHydrated() {
    if (typeof API === 'undefined') return;
    if (API.getToken() && API.getBaseUrl()) return;
    try {
      if (typeof Storage !== 'undefined' && Storage.getSession) {
        const s = await Storage.getSession();
        if (s?.baseUrl) API.init(s.baseUrl, s.token, s.endpoints, s.userId);
      }
    } catch (_) { /* ignore */ }
  }

  async function keepaliveOnce() {
    if (!Tunnel?.runBuiltinEdgeKeepaliveRound) return;
    await ensureSessionHydrated();
    const active = await Tunnel.getActiveBuiltinEdgeTunnel();
    if (!active?.projectId || !active?.nodeId) return;
    try {
      const round = await Tunnel.runBuiltinEdgeKeepaliveRound({
        projectId: active.projectId,
        nodeId: active.nodeId,
        apiRequest: saasRequest,
        tunnelFetch,
      });
      if (round?.polled?.id) {
        // v1: ack empty result; LanguageModel execute is OPT follow-up
        await tunnelFetch('result', {
          job_id: round.polled.id,
          node_id: active.nodeId,
          ok: false,
          error: 'inference_not_wired',
        });
      }
    } catch (e) {
      console.warn('[builtin-edge-tunnel] keepalive', e?.message || e);
    }
  }

  async function startAlarm() {
    if (!chrome?.alarms?.create) return;
    await chrome.alarms.clear(ALARM);
    chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    await keepaliveOnce();
  }

  if (chrome?.alarms?.onAlarm) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm?.name === ALARM) {
        keepaliveOnce();
      }
    });
  }

  /**
   * Called from handleMessage (not a second onMessage listener).
   * importScripts runs before service-worker.js registers the i18n-gated
   * listener; a second addListener here would become handlers[0] and break
   * the hydrate gate contract (i18n-sw-boot).
   */
  globalThis.startBuiltinEdgeTunnelFromMessage = async function startBuiltinEdgeTunnelFromMessage(message) {
    if (message?.projectId && message?.nodeId && Tunnel?.setActiveBuiltinEdgeTunnel) {
      await Tunnel.setActiveBuiltinEdgeTunnel({
        projectId: message.projectId,
        nodeId: message.nodeId,
      });
    }
    await startAlarm();
    return { success: true, ok: true };
  };

  // Resume keepalive when SW wakes if an active tunnel is stored.
  chrome.runtime.onStartup?.addListener?.(() => { startAlarm(); });
  chrome.runtime.onInstalled?.addListener?.(() => { startAlarm(); });
})();
