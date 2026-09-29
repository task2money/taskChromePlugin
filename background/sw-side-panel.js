/**
 * 浏览器侧边栏：工具栏打开「设置」，悬浮球等页面消息打开「创建任务」。
 * sidePanel.open 必须在用户点击的同步栈里调用，不能先 await。
 */
var pendingSidePanelMessage = null;

function beginSidePanelOpenFromGesture(tabId, which) {
  const tab = SidePanelBridge.normalizeSidePanelTab(which);
  pendingSidePanelMessage = { kind: 'message', which: tab, at: Date.now() };
  if (!tabId || typeof chrome === 'undefined' || !chrome.sidePanel || typeof chrome.sidePanel.open !== 'function') {
    return Promise.resolve({ ok: false, error: 'no tab', hint: true });
  }
  return chrome.sidePanel.open({ tabId }).then(
    () => ({ ok: true, which: tab }),
    (e) => ({ ok: false, error: e && e.message ? e.message : String(e), hint: true }),
  );
}

async function finishSidePanelOpenFromGesture(tabId, which, openedPromise) {
  const tab = SidePanelBridge.normalizeSidePanelTab(which);
  const at = pendingSidePanelMessage && pendingSidePanelMessage.at
    ? pendingSidePanelMessage.at
    : Date.now();
  await chrome.storage.session.set({
    sidePanelTab: tab,
    sidePanelOpenSource: { kind: 'message', which: tab, at },
  });
  const opened = await openedPromise;
  try {
    chrome.runtime.sendMessage({ action: 'sidePanelShow', which: tab, tabId });
  } catch (_) { /* 面板尚未监听 */ }
  if (!opened || opened.ok === false) {
    return { success: false, error: (opened && opened.error) || 'no tab', hint: true };
  }
  return { success: true, which: tab };
}

async function openSidePanelOnTab(tabId, which) {
  const opened = beginSidePanelOpenFromGesture(tabId, which);
  return finishSidePanelOpenFromGesture(tabId, which, opened);
}

async function readCreateDescBag() {
  const key = SidePanelBridge.createDescStorageKey();
  const stored = await chrome.storage.session.get(key);
  const bag = stored && stored[key];
  return bag && typeof bag === 'object' ? bag : {};
}

async function handleSidePanelMessage(message, sender) {
  if (message.action === 'getSidePanelOpenIntent') {
    const stored = await chrome.storage.session.get(['sidePanelTab', 'sidePanelOpenSource']);
    return { success: true, which: sidePanelIntentWhich(stored, Date.now()) };
  }
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
  let which = 'settings';
  try {
    const stored = await chrome.storage.session.get(['sidePanelTab', 'sidePanelOpenSource']);
    which = sidePanelIntentWhich(stored, Date.now());
  } catch (_) {
    which = 'settings';
  }
  if (which === 'settings') {
    await chrome.storage.session.set({ sidePanelTab: 'settings' });
  }
  try {
    chrome.runtime.sendMessage({ action: 'sidePanelShow', which });
  } catch (_) { /* 面板尚未监听 */ }
}

function sidePanelIntentWhich(stored, now) {
  return SidePanelBridge.resolveSidePanelIntent(
    pendingSidePanelMessage,
    stored && stored.sidePanelOpenSource,
    stored && stored.sidePanelTab,
    now,
  );
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
