/**
 * Popup: register this Chrome to a sell project + start outbound tunnel keepalive (ADR-0130/0132).
 * Visible only when logged in; project id chosen from GET /offers dropdown.
 * When registered: show registration + call stats + unregister.
 */
(function () {
  'use strict';

  const Tunnel = globalThis.BuiltinEdgeTunnel;
  const Join = globalThis.BuiltinEdgeNodeJoin;
  const Menu = globalThis.PopupBuiltinEdgeSellMenu;

  let loggedIn = false;
  let offerTitleById = {};

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

  async function fillFingerprintLine() {
    const el = document.getElementById('builtinEdgeFingerprint');
    if (!el) return;
    const FP = globalThis.PluginInstallFingerprint;
    if (!FP?.ensurePluginInstallFingerprint) {
      el.textContent = '—';
      return;
    }
    try {
      const id = await FP.ensurePluginInstallFingerprint(chrome.storage?.local);
      el.textContent = id || '—';
    } catch (_) {
      el.textContent = '—';
    }
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

  function fillList(el, lines) {
    if (!el) return;
    el.innerHTML = (Array.isArray(lines) ? lines : [])
      .map((line) => `<li>${String(line)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</li>`)
      .join('');
  }

  async function fetchNodeForActive(active) {
    const projectId = String(active?.projectId || '').trim();
    const nodeId = String(active?.nodeId || '').trim();
    if (!projectId || !nodeId) return null;
    const data = await saasRequest(
      'GET',
      `/api/cloud/v1/builtin-edge/offers/${encodeURIComponent(projectId)}/nodes`,
    );
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.find((n) => String(n?.id || '') === nodeId) || null;
  }

  async function refreshRegisteredView() {
    if (!Menu || !Tunnel) return;
    const active = await Tunnel.getActiveBuiltinEdgeTunnel();
    const registered = Menu.isEdgeSellRegistered(active);
    Menu.applyEdgeSellRegisteredMode(
      document.getElementById('builtinEdgeSellRegisterPanel'),
      document.getElementById('builtinEdgeSellRegisteredPanel'),
      registered,
    );
    const status = document.getElementById('builtinEdgeSellStatus');
    if (!registered) {
      if (status && !status.textContent) {
        status.textContent = tx('builtinEdgeSellIdle', '尚未注册到出售项目');
      }
      return;
    }
    let node = null;
    try {
      node = await fetchNodeForActive(active);
    } catch (e) {
      if (status) status.textContent = e?.message || String(e);
    }
    const view = Menu.formatEdgeSellRegisteredView(node, {
      projectId: active.projectId,
      nodeId: active.nodeId,
      projectTitle: offerTitleById[active.projectId] || '',
      deviceLabel: active.deviceLabel || '',
    }, {
      labels: {
        project: tx('builtinEdgeRegProject', '项目'),
        node: tx('builtinEdgeRegNode', '节点'),
        status: tx('builtinEdgeRegStatus', '状态'),
        device: tx('builtinEdgeRegDevice', '设备'),
        fingerprint: tx('builtinEdgeRegFingerprint', '插件指纹'),
        lastSeen: tx('builtinEdgeRegLastSeen', '最近保活'),
        inflight: tx('builtinEdgeCallInflight', '进行中'),
        dispatch: tx('builtinEdgeCallDispatch', '已分派'),
        success: tx('builtinEdgeCallSuccess', '成功'),
        error: tx('builtinEdgeCallError', '失败'),
        lastDispatch: tx('builtinEdgeCallLastDispatch', '最近分派'),
      },
    });
    fillList(document.getElementById('builtinEdgeRegistrationLines'), view.registrationLines);
    fillList(document.getElementById('builtinEdgeCallLines'), view.callLines);
    if (status) {
      status.textContent = tx('builtinEdgeSellOnline', '已注册');
      status.removeAttribute('data-traceId');
    }
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
      offerTitleById = {};
      items.forEach((o) => {
        const id = String(o?.id || '').trim();
        if (id) offerTitleById[id] = String(o?.title || id);
      });
      const menu = Menu.buildEdgeOfferSelectMenu(items, activeId, {
        placeholder: tx('builtinEdgeProjectPlaceholder', '-- 请选择出售项目 --'),
        pausedSuffix: tx('builtinEdgeProjectPaused', '(已暂停)'),
      });
      Menu.applyEdgeOfferSelect(sel, menu);
      if (!items.length && status && !Menu.isEdgeSellRegistered(
        Tunnel ? await Tunnel.getActiveBuiltinEdgeTunnel() : null,
      )) {
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
      await refreshRegisteredView();
    } catch (e) {
      if (status) status.textContent = e?.message || String(e);
    }
  }

  async function onUnregister() {
    const status = document.getElementById('builtinEdgeSellStatus');
    if (!Tunnel) return;
    const active = await Tunnel.getActiveBuiltinEdgeTunnel();
    const nodeId = String(active?.nodeId || '').trim();
    const projectId = String(active?.projectId || '').trim();
    if (!nodeId) {
      await refreshRegisteredView();
      return;
    }
    if (status) {
      status.textContent = tx('builtinEdgeUnregistering', '正在取消注册…');
      status.removeAttribute('data-traceId');
    }
    try {
      await saasRequest('POST', `/api/cloud/v1/builtin-edge/nodes/${encodeURIComponent(nodeId)}/revoke`, {}, {
        'Idempotency-Key': newIdem('edge-revoke'),
      });
      if (Join?.clearBuiltinEdgeNodeJoin && projectId) {
        await Join.clearBuiltinEdgeNodeJoin(projectId);
      }
      try {
        await chrome.runtime.sendMessage({ action: 'stopBuiltinEdgeTunnel' });
      } catch (_) {
        if (Tunnel.clearActiveBuiltinEdgeTunnel) {
          await Tunnel.clearActiveBuiltinEdgeTunnel();
        }
      }
      if (status) status.textContent = tx('builtinEdgeUnregistered', '已取消注册');
      await loadOfferSelect();
      await refreshRegisteredView();
    } catch (e) {
      if (status) status.textContent = e?.message || String(e);
    }
  }

  function refreshVisibility() {
    if (!Menu) return;
    Menu.applyEdgeSellSectionVisibility(sectionEl(), loggedIn);
    if (loggedIn) {
      fillFingerprintLine().catch(() => {});
      if (document.getElementById('builtinEdgeProjectId')) {
        loadOfferSelect()
          .then(() => refreshRegisteredView())
          .catch(() => {});
      }
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
    const unreg = document.getElementById('btnBuiltinEdgeUnregister');
    const guard = globalThis.ClickGuard?.createClickGuard
      ? ClickGuard.createClickGuard()
      : null;
    const unregGuard = globalThis.ClickGuard?.createClickGuard
      ? ClickGuard.createClickGuard()
      : null;
    btn?.addEventListener('click', () => {
      if (guard) guard.run(onRegister);
      else onRegister();
    });
    unreg?.addEventListener('click', () => {
      if (unregGuard) unregGuard.run(onUnregister);
      else onUnregister();
    });
    refreshVisibility();
  }

  globalThis.PopupBuiltinEdgeSell = { setLoggedIn };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
