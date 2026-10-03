/**
 * 侧边栏壳：页签只隐藏、不卸载。创建表单脚本在本页加载；设置复用 popup；内置模型为完整管理面板。
 */
(function initSidePanelShell() {
  'use strict';

  const SKIP = {
    'content/float-pick.js': true,
    'content/float-page-advisor-region.js': true,
    'content/float-page-advisor-layer.js': true,
    'content/float-page-advisor-drag.js': true,
    'content/float-page-advisor.js': true,
    'content/float-page-advisor-site-pending.js': true,
  };

  function normalizeTab(which) {
    if (typeof SidePanelBridge !== 'undefined' && SidePanelBridge.normalizeSidePanelTab) {
      return SidePanelBridge.normalizeSidePanelTab(which);
    }
    if (which === 'settings') return 'settings';
    if (which === 'builtin') return 'builtin';
    return 'create';
  }

  function showTab(which) {
    const tab = normalizeTab(which);
    const createPane = document.getElementById('sp-pane-create');
    const settingsPane = document.getElementById('sp-pane-settings');
    const builtinPane = document.getElementById('sp-pane-builtin');
    const createBtn = document.getElementById('sp-tab-create');
    const settingsBtn = document.getElementById('sp-tab-settings');
    const builtinBtn = document.getElementById('sp-tab-builtin');
    const showCreate = tab === 'create';
    const showSettings = tab === 'settings';
    const showBuiltin = tab === 'builtin';
    createPane.hidden = !showCreate;
    settingsPane.hidden = !showSettings;
    if (builtinPane) builtinPane.hidden = !showBuiltin;
    createBtn.setAttribute('aria-selected', showCreate ? 'true' : 'false');
    settingsBtn.setAttribute('aria-selected', showSettings ? 'true' : 'false');
    if (builtinBtn) builtinBtn.setAttribute('aria-selected', showBuiltin ? 'true' : 'false');
    if (showBuiltin && globalThis.SidepanelBuiltinPanel && SidepanelBuiltinPanel.probeDetails) {
      SidepanelBuiltinPanel.probeDetails().catch(() => {});
    }
  }

  async function activeTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] && tabs[0].id;
  }

  async function rememberTab() {
    const id = await activeTabId();
    if (id) globalThis.__taskpluginSidePanelTabId = id;
    return id;
  }

  async function applyStoredDescription(tabId) {
    const key = 'sidePanelCreateDesc';
    const stored = await chrome.storage.session.get(key);
    const bag = (stored && stored[key]) || {};
    const desc = document.getElementById('taskplugin-desc');
    if (!desc || !tabId) return;
    const next = bag[String(tabId)] || '';
    if (desc.value !== next) desc.value = next;
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = chrome.runtime.getURL(url);
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(url));
      document.body.appendChild(el);
    });
  }

  async function loadFormScripts() {
    const files = chrome.runtime.getManifest().content_scripts[0].js;
    for (let i = 0; i < files.length; i += 1) {
      if (SKIP[files[i]]) continue;
      await loadScript(files[i]);
    }
  }

  document.getElementById('sp-tab-create').addEventListener('click', () => showTab('create'));
  document.getElementById('sp-tab-settings').addEventListener('click', () => showTab('settings'));
  const builtinTabBtn = document.getElementById('sp-tab-builtin');
  if (builtinTabBtn) {
    builtinTabBtn.addEventListener('click', () => showTab('builtin'));
  }

  window.addEventListener('message', (event) => {
    const message = event && event.data;
    if (!message || message.action !== 'sidePanelShow') return;
    showTab(message.which);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.action === 'sidePanelShow') {
      showTab(message.which);
      return;
    }
    if (message.action !== 'createDescriptionUpdated') return;
    const current = globalThis.__taskpluginSidePanelTabId;
    if (current && String(message.tabId) !== String(current)) return;
    const description = String(message.description || '');
    const desc = document.getElementById('taskplugin-desc');
    if (desc && desc.value !== description) desc.value = description;
    if (description.trim()) showTab('create');
  });

  async function applyVisibleTab() {
    let which = 'settings';
    try {
      const intent = await chrome.runtime.sendMessage({ action: 'getSidePanelOpenIntent' });
      if (intent && (intent.which === 'create' || intent.which === 'settings' || intent.which === 'builtin')) {
        which = intent.which;
      }
    } catch (_) {
      which = 'settings';
    }
    showTab(which);
    if (which === 'settings' || which === 'builtin') {
      await chrome.storage.session.set({ sidePanelTab: which });
    }
  }

  chrome.tabs.onActivated.addListener((info) => {
    globalThis.__taskpluginSidePanelTabId = info.tabId;
    applyStoredDescription(info.tabId).catch(() => {});
  });

  if (chrome.sidePanel && chrome.sidePanel.onOpened && chrome.sidePanel.onOpened.addListener) {
    chrome.sidePanel.onOpened.addListener(() => {
      applyVisibleTab().catch(() => {});
    });
  }

  (async function boot() {
    try {
      if (globalThis.AidevpushI18n && typeof AidevpushI18n.hydrateFromStorage === 'function') {
        await AidevpushI18n.hydrateFromStorage().catch(() => {});
        if (typeof AidevpushI18n.applyDom === 'function') AidevpushI18n.applyDom(document);
      }
      if (globalThis.SidepanelBuiltinPanel && SidepanelBuiltinPanel.updateTabVisibility) {
        SidepanelBuiltinPanel.updateTabVisibility();
      }
      await applyVisibleTab();
      await rememberTab();
      await loadFormScripts();
      const desc = document.getElementById('taskplugin-desc');
      if (desc) {
        desc.addEventListener('input', () => {
          const tabId = globalThis.__taskpluginSidePanelTabId;
          chrome.runtime.sendMessage({
            action: 'setCreateDescription',
            description: desc.value,
            open: false,
            tabId,
          }).catch(() => {});
        });
      }
      await applyStoredDescription(globalThis.__taskpluginSidePanelTabId);
    } catch (e) {
      console.error('[taskChromePlugin] 侧边栏加载失败:', e && e.message ? e.message : e);
    }
  })();
})();
