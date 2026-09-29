/**
 * 浏览器侧边栏：工具栏打开「设置」，页面消息打开「创建任务」，按标签页保存任务描述。
 */
async function openSidePanelOnTab(tabId, which) {
  const tab = SidePanelBridge.normalizeSidePanelTab(which);
  await chrome.storage.session.set({ sidePanelTab: tab });
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

if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    const ready = typeof whenI18nReady === 'function' ? whenI18nReady() : Promise.resolve();
    ready
      .then(() => openSidePanelOnTab(tab && tab.id, 'settings'))
      .catch((e) => {
        console.warn('[taskChromePlugin] 打开侧边栏设置失败:', e && e.message ? e.message : e);
      });
  });
}
