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
  };
  const en = {
    paSitePostTabsAria: 'Switch auto-innovate suggestions',
    paSitePostTabAria: 'Show suggestion {n}: {title}',
    paSitePostFallback: 'Suggestion {n}',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
