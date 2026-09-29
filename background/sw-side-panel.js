/**
 * 浏览器侧边栏：工具栏打开「设置」，页面消息打开「创建任务」，按标签页保存任务描述。
 */
async function openSidePanelOnTab(tabId, which) {
  const tab = SidePanelBridge.normalizeSidePanelTab(which);
  await chrome.storage.session.set({
    sidePanelTab: tab,
    sidePanelOpenSource: { kind: 'message', at: Date.now() },
  });
  if (!tabId) return { success: false, error: 'no tab', hint: true };
  try {
    await chrome.sidePanel.open({ tabId });
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e), hint: true };
  }
  try {
    chrome.runtime.sendMessage({ action: 'sidePanelShow', which: tab, tabId });
  } catch (_) { /* 面板尚未监听 */ }
  return { success: true, which: tab };
}

async function readCreateDescBag() {
  const key = SidePanelBridge.createDescStorageKey();
  const stored = await chrome.storage.session.get(key);
  const bag = stored && stored[key];
  return bag && typeof bag === 'object' ? bag : {};
}

async function handleSidePanelMessage(message, sender) {
  if (message.action === 'openSidePanel') {
    const tabId = sender.tab && sender.tab.id;
    return openSidePanelOnTab(tabId, message.which);
  }
  if (message.action === 'getCreateDescription') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return { success: true, description: '' };
    const bag = await readCreateDescBag();
    return { success: true, description: bag[String(tabId)] || '' };
  }
  if (message.action === 'setCreateDescription') {
    const tabId = (sender.tab && sender.tab.id) || message.tabId;
    if (!tabId) return { success: false, error: 'no tab' };
    const description = String(message.description || '');
    const key = SidePanelBridge.createDescStorageKey();
    const bag = await readCreateDescBag();
    bag[String(tabId)] = description;
    await chrome.storage.session.set({ [key]: bag });
    try {
      chrome.runtime.sendMessage({
        action: 'createDescriptionUpdated',
        tabId,
        description,
      });
    } catch (_) { /* 面板未打开 */ }
    if (message.open) return openSidePanelOnTab(tabId, 'create');
    return { success: true };
  }
  if (message.action === 'relayPageToast') {
    let tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tabs[0] && tabs[0].id;
    }
    if (!tabId) return { success: false, error: 'no tab' };
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'relayPageToast',
        text: message.text,
        opts: message.opts || {},
      });
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : String(e) };
    }
    return { success: true };
  }
  return { success: false, error: 'unknown side panel action' };
}

async function applyIconOpenTab() {
  let source = null;
  try {
    const stored = await chrome.storage.session.get('sidePanelOpenSource');
    source = stored && stored.sidePanelOpenSource;
    await chrome.storage.session.remove('sidePanelOpenSource');
  } catch (_) {
    source = null;
  }
  if (!SidePanelBridge.iconOpenShouldSelectSettings(source, Date.now())) return;
  await chrome.storage.session.set({ sidePanelTab: 'settings' });
  try {
    chrome.runtime.sendMessage({ action: 'sidePanelShow', which: 'settings' });
  } catch (_) { /* 面板尚未监听 */ }
}

function installToolbarSidePanelToggle() {
  if (typeof chrome === 'undefined' || !chrome.sidePanel) return;
  if (typeof chrome.sidePanel.setPanelBehavior === 'function') {
    chrome.sidePanel
      .setPanelBehavior(SidePanelBridge.toolbarActionPanelBehavior())
      .catch((e) => {
        console.warn('[taskChromePlugin] 工具栏图标切换侧边栏失败:', e && e.message ? e.message : e);
      });
  }
  if (chrome.sidePanel.onOpened && typeof chrome.sidePanel.onOpened.addListener === 'function') {
    chrome.sidePanel.onOpened.addListener(() => {
      applyIconOpenTab().catch((e) => {
        console.warn('[taskChromePlugin] 图标打开侧边栏切到设置失败:', e && e.message ? e.message : e);
      });
    });
  }
  if (chrome.sidePanel.onClosed && typeof chrome.sidePanel.onClosed.addListener === 'function') {
    chrome.sidePanel.onClosed.addListener(() => {
      chrome.storage.session.remove('sidePanelOpenSource').catch(() => {});
    });
  }
}

installToolbarSidePanelToggle();
