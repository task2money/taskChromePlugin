/**
 * 侧栏「给当前网页生成建议」的失败诊断出口。
 *
 * 每次终态落一条本地记录（成功含落贴、成功未落贴、落贴失败、生成失败），
 * 只保留白名单字段，不记录页面正文；侧栏「复制诊断信息」由这里统一组装文本。
 */

'use strict';

/** 插件版本进诊断记录：用户反馈时要能对上具体构建。 */
function agentSuggestionsPluginVersion() {
  try {
    const Version = typeof PluginVersion !== 'undefined' ? PluginVersion : null;
    return Version && typeof Version.readExtensionVersion === 'function'
      ? String(Version.readExtensionVersion() || '').trim()
      : '';
  } catch (_e) {
    return '';
  }
}

/** post_error（unavailable / closed）→ 可读原因；未知值原样返回。 */
function agentSuggestionPostErrorText(postError) {
  if (postError === 'unavailable') return tx('agentSuggestionsPostUnavailable');
  if (postError === 'closed') return tx('agentSuggestionsPostClosed');
  return String(postError || '');
}

/**
 * 每次终态落一条诊断记录（成功含落贴、成功未落贴、落贴失败、生成失败）。
 * 存储失败只 warn，绝不影响生成结果。
 */
async function appendAgentSuggestionDiagnostics(entry, reporter) {
  const Diag = typeof AgentSuggestionsDiagnostics !== 'undefined'
    ? AgentSuggestionsDiagnostics
    : null;
  if (!Diag || typeof Diag.append !== 'function') return false;
  try {
    return await Diag.append({
      ...entry,
      stageTimeline: reporter && typeof reporter.getTimeline === 'function'
        ? reporter.getTimeline()
        : [],
      pluginVersion: agentSuggestionsPluginVersion(),
    });
  } catch (e) {
    console.warn('[taskChromePlugin] agent_suggestion_diagnostics_failed:', e?.message || e);
    return false;
  }
}

/**
 * 侧栏「复制诊断信息」：后台组装当前 tab 的当前记录 + 最近尝试文本，
 * 侧栏不直接读 storage，保持单一数据源。
 */
async function handleGetAgentSuggestionsDiagnostics(message) {
  const Diag = typeof AgentSuggestionsDiagnostics !== 'undefined'
    ? AgentSuggestionsDiagnostics
    : null;
  if (!Diag) return { success: false, text: '', error: 'diagnostics_unavailable' };
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  const wanted = Number(message && message.tabId);
  const tabId = Number.isInteger(wanted) && wanted >= 0 ? wanted : (tab && tab.id);
  const recent = await Diag.list();
  const current = Number.isInteger(Number(tabId)) && Number(tabId) >= 0
    ? await Diag.latestForTab(Number(tabId))
    : (recent[0] || null);
  return { success: true, text: Diag.buildCopyText(current, recent), current };
}
