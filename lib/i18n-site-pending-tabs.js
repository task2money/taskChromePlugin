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
    agentSuggestionsHint: '这里只放还没采纳、也没废弃的建议贴。网址留空则查询当前网页，填写后查询该网址。点一张建议贴，当前页就显示这一条建议；再点另一张，页面换成后一条。页面上不再另放建议浮层。',
    agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
    agentSuggestionsEmptyUrl: '该网址没有待处理的智能体建议',
    agentSuggestionsInvalidUrl: '请输入 http 或 https 网址，或留空查询当前网页',
    agentSuggestionsTypedScope: '正在查看 {url} 的智能体建议，切换网页标签不改变这里的结果',
    agentSuggestionsUrlPlaceholder: '留空则查询当前网页',
    agentSuggestionsUrlLabel: '要查询的网址',
    agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
    agentSuggestionsLoadFail: '智能体建议加载失败',
    agentSuggestionsIncludeQuery: '查询时包含网址参数',
    agentSuggestionsQuery: '查询',
    agentSuggestionsCountAria: '{n} 条待处理',
    agentSuggestionsPostCount: '{n} 条建议',
    agentSuggestionsOpenPost: '打开帖子',
  };
  const en = {
    paSitePostTabsAria: 'Switch auto-innovate suggestions',
    paSitePostTabAria: 'Show suggestion {n}: {title}',
    paSitePostFallback: 'Suggestion {n}',
    agentSuggestionsTab: 'Agent suggestions',
    agentSuggestionsHint: 'This tab only lists pending suggestion stickers. Leave the URL empty to look up the current page, or enter a URL to look up that page. Select a sticker to show that suggestion on the current page; select another to switch it. The page does not keep its own suggestion overlay.',
    agentSuggestionsEmpty: 'This page has no pending agent suggestions',
    agentSuggestionsEmptyUrl: 'This URL has no pending agent suggestions',
    agentSuggestionsInvalidUrl: 'Enter an http(s) URL, or leave the box empty to use the current page',
    agentSuggestionsTypedScope: 'Showing agent suggestions for {url}; switching browser tabs keeps this result',
    agentSuggestionsUrlPlaceholder: 'Leave empty to look up the current page',
    agentSuggestionsUrlLabel: 'Page URL to look up',
    agentSuggestionsLogin: 'Sign in to see agent suggestions for this page',
    agentSuggestionsLoadFail: 'Could not load agent suggestions',
    agentSuggestionsIncludeQuery: 'Include URL parameters in the lookup',
    agentSuggestionsQuery: 'Look up',
    agentSuggestionsCountAria: '{n} pending',
    agentSuggestionsPostCount: '{n} suggestions',
    agentSuggestionsOpenPost: 'Open post',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
