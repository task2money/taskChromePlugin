/** chrome.commands 入口与遗留快捷键迁移（从 sw-page-advisor 拆出以守 500 行）。 */

'use strict';

async function handlePageOptimizationSuggestCommand() {
  markPageAdvisorSuggestCommand('alt-z');
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  await runPageOptimizationSuggest(tabId);
}

async function handlePageOptimizationSuggestRegionCommand() {
  markPageAdvisorSuggestCommand('alt-shift-z');
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'startPageAdvisorRegionSelect' }, { frameId: 0 });
  } catch (frame0Err) {
    console.warn('[taskChromePlugin] startPageAdvisorRegionSelect frame0 失败，回退整 tab:', frame0Err?.message || frame0Err);
    await chrome.tabs.sendMessage(tabId, { action: 'startPageAdvisorRegionSelect' });
  }
}

async function clearLegacyPageAdvisorChromeShortcuts() {
  if (
    typeof chrome.commands?.getAll !== 'function'
    || typeof chrome.commands?.update !== 'function'
  ) {
    return;
  }
  const legacy = new Set([
    'Alt+E',
    'Alt+Shift+E',
    'Alt+`',
    'Alt+Shift+`',
    'Alt+Backquote',
    'Alt+Shift+Backquote',
  ]);
  const defaults = {
    'page-optimization-suggest': 'Alt+Z',
    'page-optimization-suggest-region': 'Alt+Shift+Z',
  };
  try {
    const commands = await chrome.commands.getAll();
    for (const [name, desired] of Object.entries(defaults)) {
      const found = (commands || []).find((c) => c && c.name === name);
      const sc = String(found?.shortcut || '');
      if (legacy.has(sc)) {
        await chrome.commands.update({ name, shortcut: desired });
        continue;
      }
      if (!sc) {
        await chrome.commands.update({ name, shortcut: desired });
      }
    }
  } catch (e) {
    console.warn(
      '[taskChromePlugin] migrate page-advisor shortcuts:',
      e?.message || e,
    );
  }
}
