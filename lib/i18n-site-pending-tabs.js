/**
 * Tab labels for several pending suggestion posts on one URL.
 * Separate file so i18n-ui-messages.js is not grown.
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    paSitePostTabsAria: '切换自动创新建议',
    paSitePostTabAria: '显示第 {n} 条建议：{title}',
    paSitePostFallback: '建议 {n}',
    agentSuggestionsTab: '智能体建议',
    agentSuggestionsHint: '这里列出当前网页上还没采纳、也没废弃的自动创新建议。点标题查看该帖，并可标记采纳或废弃。',
    agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
    agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
    agentSuggestionsLoadFail: '智能体建议加载失败',
    agentSuggestionsIncludeQuery: '查询时包含网址参数',
    agentSuggestionsQuery: '查询',
    agentSuggestionsCountAria: '{n} 条待处理',
  };
  const en = {
    paSitePostTabsAria: 'Switch auto-innovate suggestions',
    paSitePostTabAria: 'Show suggestion {n}: {title}',
    paSitePostFallback: 'Suggestion {n}',
    agentSuggestionsTab: 'Agent suggestions',
    agentSuggestionsHint: 'Pending auto-innovate posts for this page. Select a title to read that post, then adopt or discard it.',
    agentSuggestionsEmpty: 'This page has no pending agent suggestions',
    agentSuggestionsLogin: 'Sign in to see agent suggestions for this page',
    agentSuggestionsLoadFail: 'Could not load agent suggestions',
    agentSuggestionsIncludeQuery: 'Include URL parameters in the lookup',
    agentSuggestionsQuery: 'Look up',
    agentSuggestionsCountAria: '{n} pending',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
