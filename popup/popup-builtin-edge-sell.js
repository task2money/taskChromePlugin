/**
 * Popup: register this Chrome to a sell project + start outbound tunnel keepalive (ADR-0130).
 * Visible only when logged in; project id chosen from GET /offers dropdown.
 */
(function () {
  'use strict';

  const Tunnel = globalThis.BuiltinEdgeTunnel;
  const Join = globalThis.BuiltinEdgeNodeJoin;
  const Menu = globalThis.PopupBuiltinEdgeSellMenu;

  let loggedIn = false;

  function tx(key, fallback) {
    try {
      if (globalThis.AidevpushI18n?.t) return AidevpushI18n.t(key) || fallback;
    } catch (_) { /* ignore */ }
    return fallback;
  }

  function newIdem(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sectionEl() {
    return document.getElementById('builtinEdgeSellSection');
  }

  function selectEl() {
    return document.getElementById('builtinEdgeProjectId');
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

  async function loadOfferSelect() {
    const sel = selectEl();
    if (!sel || !Menu) return;
    const status = document.getElementById('builtinEdgeSellStatus');
    let activeId = '';
    try {
      const active = Tunnel ? await Tunnel.getActiveBuiltinEdgeTunnel() : null;
      activeId = String(active?.projectId || '').trim();
    } catch (_) { /* ignore */ }
    try {
      const data = await saasRequest('GET', '/api/cloud/v1/builtin-edge/offers');
      const items = Array.isArray(data?.items) ? data.items : [];
      const menu = Menu.buildEdgeOfferSelectMenu(items, activeId, {
        placeholder: tx('builtinEdgeProjectPlaceholder', '-- 请选择出售项目 --'),
        pausedSuffix: tx('builtinEdgeProjectPaused', '(已暂停)'),
      });
      Menu.applyEdgeOfferSelect(sel, menu);
      if (!items.length && status) {
        status.textContent = tx('builtinEdgeProjectEmpty', '暂无出售项目，请先在账号中心创建');
      }
    } catch (e) {
      Menu.applyEdgeOfferSelect(sel, Menu.buildEdgeOfferSelectMenu([], '', {
        placeholder: tx('builtinEdgeProjectPlaceholder', '-- 请选择出售项目 --'),
      }));
      if (status) {
        status.textContent = e?.message || String(e);
        const tid = String(e?.traceId || '').trim();
        if (tid) status.setAttribute('data-traceId', tid);
        else status.removeAttribute('data-traceId');
      }
    }
  }

  async function onRegister() {
    const sel = selectEl();
    const labelInput = document.getElementById('builtinEdgeDeviceLabel');
    const status = document.getElementById('builtinEdgeSellStatus');
    const projectId = String(sel?.value || '').trim();
    if (!projectId) {
      if (status) {
        status.textContent = tx('builtinEdgeNeedProjectId', '请选择出售项目');
        status.removeAttribute('data-traceId');
      }
      return;
    }
    if (!Tunnel || !Join) {
      if (status) status.textContent = 'BuiltinEdgeTunnel missing';
      return;
    }
    if (status) {
      status.textContent = tx('builtinEdgeRegistering', '正在注册…');
      status.removeAttribute('data-traceId');
    }
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

  function refreshVisibility() {
    if (!Menu) return;
    Menu.applyEdgeSellSectionVisibility(sectionEl(), loggedIn);
    if (loggedIn) {
      loadOfferSelect().then(() => refreshStatusEl()).catch(() => {});
    }
  }

  function setLoggedIn(next) {
    loggedIn = Boolean(next);
    refreshVisibility();
  }

  function bind() {
    const section = sectionEl();
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
    // Anti-Replay-OK: select change is local UI only
    refreshVisibility();
  }

  globalThis.PopupBuiltinEdgeSell = { setLoggedIn };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
