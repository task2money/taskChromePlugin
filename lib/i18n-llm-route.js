/**
 * 自动创新调用方式文案（ADR-0106）。后加载以覆盖停售期「不再扣次」旧句。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    paLlmSectionHint: '在本区选择调用方式。直连使用本机 Key，不扣平台次数；调用平台后端时，成功出建议扣 1 次自动创新。密钥只保存在本机。快捷键见标题旁 Alt+Shift+Z，整页快捷键走同一调用方式。点击「设置」填写 API Key。',
    paLlmRouteLegend: '调用方式',
    paLlmRouteDirect: '直连我的 Key（不扣平台次数）',
    paLlmRouteSaas: '调用平台后端（成功扣 1 次）',
    paDirectNeedsConfig: '已选择直连，请先在弹窗填写 API Key、Base URL 和模型，或改选调用平台后端。',
    paQuotaExhausted: '自动创新次数已用尽。平台后端成功出建议会扣 1 次；也可在扩展弹窗改为直连自有 Key。',
  };
  const en = {
    paLlmSectionHint: 'Choose the call path in this section. Direct uses your on-device key and does not deduct platform uses. The platform backend deducts 1 auto-innovate use when a suggestion succeeds. The key stays on this device. See Alt+Shift+Z in the heading; the whole-page shortcut uses the same path. Click Settings to enter the API Key.',
    paLlmRouteLegend: 'Call path',
    paLlmRouteDirect: 'Direct with my key (no platform deduction)',
    paLlmRouteSaas: 'Platform backend (1 use on success)',
    paDirectNeedsConfig: 'Direct is selected. Enter the API Key, Base URL, and model in the popup, or switch to the platform backend.',
    paQuotaExhausted: 'Auto-innovate uses are exhausted. The platform backend deducts 1 use when a suggestion succeeds. You can switch the popup to a direct key instead.',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
