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
    agentSuggestionsTab: '网页优化建议',
    agentSuggestionsHint: '这里只放还没采纳、也没废弃的建议贴，固定看当前网页。选一条提示词后点「给当前网页生成建议」，会自动把优化贴落到首页域名所属的项目；域名还没绑到任何项目时，落到你的默认项目。点一张建议贴，当前页就显示这一条建议；再点另一张，页面换成后一条。页面上不再另放建议浮层。',
    agentSuggestionsEmpty: '当前网页没有待处理的智能体建议',
    agentSuggestionsLogin: '登录后可查看当前网页的智能体建议',
    agentSuggestionsLoadFail: '智能体建议加载失败',
    agentSuggestionsPromptLabel: '提示词',
    agentSuggestionsPromptDefault: '默认提示词',
    agentSuggestionsGenerate: '给当前网页生成建议',
    agentSuggestionsGenerating: '正在为当前网页生成建议…',
    agentSuggestionsGeneratedInto: '已在「{project}」创建优化贴',
    agentSuggestionsPostedExisting: '「{project}」里已有当前网页的优化贴',
    agentSuggestionsGenerateFail: '生成建议失败',
    agentSuggestionsGenerateBuiltin: '内置模型建议请在页面上按 Alt+Z 生成',
    agentSuggestionsReloadRetry: '刷新当前网页并重试',
    agentSuggestionsReloading: '正在刷新当前网页…',
    agentSuggestionsCountAria: '{n} 条待处理',
    agentSuggestionsPostCount: '{n} 条建议',
    agentSuggestionsOpenPost: '打开帖子',
  };
  const en = {
    paSitePostTabsAria: 'Switch auto-innovate suggestions',
    paSitePostTabAria: 'Show suggestion {n}: {title}',
    paSitePostFallback: 'Suggestion {n}',
    agentSuggestionsTab: 'Page optimization suggestions',
    agentSuggestionsHint: 'This tab only lists pending suggestion stickers for the current page. Pick a prompt and select “Generate suggestions for this page”; the new post lands in the project that owns the page domain, or in your default project when the domain is not bound yet. Select a sticker to show that suggestion on the current page; select another to switch it. The page does not keep its own suggestion overlay.',
    agentSuggestionsEmpty: 'This page has no pending agent suggestions',
    agentSuggestionsLogin: 'Sign in to see agent suggestions for this page',
    agentSuggestionsLoadFail: 'Could not load agent suggestions',
    agentSuggestionsPromptLabel: 'Prompt',
    agentSuggestionsPromptDefault: 'Default prompt',
    agentSuggestionsGenerate: 'Generate suggestions for this page',
    agentSuggestionsGenerating: 'Generating suggestions for this page…',
    agentSuggestionsGeneratedInto: 'Created a suggestion post in “{project}”',
    agentSuggestionsPostedExisting: '“{project}” already has a post for this page',
    agentSuggestionsGenerateFail: 'Could not generate suggestions',
    agentSuggestionsGenerateBuiltin: 'Press Alt+Z on the page to generate with the built-in model',
    agentSuggestionsReloadRetry: 'Refresh this page and retry',
    agentSuggestionsReloading: 'Refreshing this page…',
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
