/**
 * 侧边栏壳：两个页签只隐藏、不卸载。创建表单脚本在本页加载；设置复用 popup。
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

  function showTab(which) {
    const tab = which === 'settings' ? 'settings' : 'create';
    const createPane = document.getElementById('sp-pane-create');
    const settingsPane = document.getElementById('sp-pane-settings');
    const createBtn = document.getElementById('sp-tab-create');
    const settingsBtn = document.getElementById('sp-tab-settings');
    const showCreate = tab === 'create';
    createPane.hidden = !showCreate;
    settingsPane.hidden = showCreate;
    createBtn.setAttribute('aria-selected', showCreate ? 'true' : 'false');
    settingsBtn.setAttribute('aria-selected', showCreate ? 'false' : 'true');
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
      if (intent && (intent.which === 'create' || intent.which === 'settings')) which = intent.which;
    } catch (_) {
      which = 'settings';
    }
    showTab(which);
    if (which === 'settings') {
      await chrome.storage.session.set({ sidePanelTab: 'settings' });
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
