/**
 * Locale switcher copy (ADR-0089). Separate file so i18n-ui-messages.js is not grown.
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    pluginLocaleLabel: '语言',
    pluginLocaleZh: '中文',
    pluginLocaleEn: 'English',
  };
  const en = {
    pluginLocaleLabel: 'Language',
    pluginLocaleZh: 'Chinese',
    pluginLocaleEn: 'English',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
