/**
 * 侧栏「给当前网页生成建议」的采集通道探针与「刷新当前网页并重试」。
 *
 * 开发者模式重载扩展后，已打开页面的 content script 会随旧实例失效（页面浮窗
 * DOM 还在，看着一切正常），刷新页面即可恢复。刷新会丢页面未保存状态，故这条
 * 路径只由用户点击触发，绝不做自动刷新。
 */

'use strict';

/**
 * 「刷新当前网页并重试」的等待预算：等 tab 回到 complete 后再探采集通道是否恢复。
 * 刷新会丢页面未保存状态，故这条路径只由用户点击触发，绝不自动刷新。
 */
var AGENT_SUGGESTIONS_CONTENT_READY_MS = 15000;
var AGENT_SUGGESTIONS_PROBE_POLL_MS = 300;

/**
 * 采集通道存活探针：只用轻量 ping，绝不用 `getPageAdvisorContext`——
 * 后者会消费已框选/拾取的元素并清空选区，当探针用会吃掉用户的选择。
 * 主 frame 优先，打不通再整 tab 广播（与采集同口径）。
 *
 * @returns {Promise<{ready: boolean, instanceId: string}|null>} `null` = 监听器不在。
 */
async function pingAgentSuggestionsChannel(tabId) {
  const ping = { action: 'pingPageAdvisorContext' };
  const read = (resp) => (resp && resp.success
    ? { ready: !!resp.ready, instanceId: String(resp.instanceId || '') }
    : null);
  try {
    const hit = read(await chrome.tabs.sendMessage(tabId, ping, { frameId: 0 }));
    if (hit) return hit;
  } catch (_) { /* 主 frame 没有监听器，退整 tab 广播 */ }
  try {
    return read(await chrome.tabs.sendMessage(tabId, ping));
  } catch (_) {
    // 监听器不在（扩展重载后的旧页面）→ 连接直接失败，正是要判死的情形。
    return null;
  }
}

/** 当前页面采集通道状态：`ready` / `restricted`（刷新无用）/ `unreachable`（刷新可修）。 */
async function agentSuggestionsChannelState(tabId, url) {
  if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(url)) return 'restricted';
  const ping = await pingAgentSuggestionsChannel(tabId);
  return (ping && ping.ready) ? 'ready' : 'unreachable';
}

/** 侧栏打开 / 切 tab 时探一次：只回答「要不要把刷新入口摆出来」。 */
async function handleProbeAgentSuggestionsChannel() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, reason: 'no_active_tab' };
  const state = await agentSuggestionsChannelState(tab.id, tab.url);
  return {
    success: true,
    state,
    // 与生成失败时同码：侧栏据此决定是否露出「刷新并重试」。
    errorCode: state === 'unreachable' ? 'PAGE_CONTEXT_UNREACHABLE' : '',
    retryable: state === 'unreachable',
  };
}

/** 等 tab 加载完并重新探到采集通道；刷新后 content script 要重新注入。 */
async function waitForAgentSuggestionsChannel(tabId, staleInstanceId) {
  const budget = Number(AGENT_SUGGESTIONS_CONTENT_READY_MS) > 0
    ? Number(AGENT_SUGGESTIONS_CONTENT_READY_MS)
    : 15000;
  const pollMs = Number(AGENT_SUGGESTIONS_PROBE_POLL_MS) > 0 ? Number(AGENT_SUGGESTIONS_PROBE_POLL_MS) : 300;
  const deadline = Date.now() + budget;
  const stale = String(staleInstanceId || '');
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.status === 'complete') {
      const ping = await pingAgentSuggestionsChannel(tabId);
      // instanceId 与刷新前相同 = 新文档还没提交，探到的是即将被替换掉的旧实例，
      // 此刻「通了」是假象：收工太早会让用户点完刷新又失败一次。
      if (ping && ping.ready && ping.instanceId !== stale) return true;
      // 页面类型本身不支持：刷新也不会变好，别再空等。
      if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(tab.url)) return false;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

/**
 * 「刷新当前网页并重试」：开发者模式重载扩展后，已打开页面的 content script 会随旧实例
 * 失效（页面浮窗 DOM 还在，看着一切正常），刷新页面即可恢复。
 *
 * 刷新会丢页面未保存状态，所以只由用户点击触发，这里不做任何自动刷新。通道恢复后
 * 由侧栏重跑一次生成——生成本身是「生成 → 落贴」的同一段代码，不在这里复制一份。
 */
async function handleReloadActiveTabAndRetry() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab?.id) return { success: false, error: tx('swNoActiveTab') };
  if (typeof isPageAdvisorBlockedUrl === 'function' && isPageAdvisorBlockedUrl(tab.url)) {
    // 刷新不会让此类页面变得可采集：别让用户白等一次刷新（页面状态还会丢）。
    return { success: false, error: tx('paContextRestrictedPage'), errorCode: 'PAGE_CONTEXT_RESTRICTED_PAGE' };
  }
  // 先记下刷新前那个实例：刷新后只有换过实例才算真恢复。
  const before = await pingAgentSuggestionsChannel(tab.id);
  await chrome.tabs.reload(tab.id);
  if (!await waitForAgentSuggestionsChannel(tab.id, before ? before.instanceId : '')) {
    return { success: false, error: tx('paContextUnreachable'), errorCode: 'PAGE_CONTEXT_UNREACHABLE' };
  }
  console.info('[taskChromePlugin] page_context_recovered', { tabId: tab.id });
  return { success: true };
}
