/**
 * 自动创新文案（ADR-0106）：调用方式文案 + 智能体设置区字面量。
 * 后加载以覆盖基础表中与停售期「不再扣次」相关的句子。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    paLlmSectionHint: '在本区选择调用方式。直连我的 Key 为免费。未选择时默认直连。密钥只保存在本机。快捷键见标题旁 Alt+Shift+Z，整页快捷键走同一调用方式。点击「设置」填写 API Key。',
    paLlmRouteLegend: '调用方式',
    paLlmRouteDirect: '直连我的 Key（免费）',
    paLlmRouteSaas: '调用平台后端',
    paDirectNeedsConfig: '已选择直连，请先在弹窗填写 API Key、Base URL 和模型，或改选调用平台后端。',
    paQuotaExhausted: '自动创新次数已用尽。平台后端成功出建议会扣 1 次；也可在扩展弹窗改为直连自有 Key。',
    paLlmSectionTitle: '自动创新智能体',
    paLlmSettings: '设置',
    paLlmSettingsAria: '打开智能体 API Key 设置',
    paLlmBaseUrl: 'API Base URL',
    paLlmModel: '模型',
    paLlmApiKey: 'API Key',
    paLlmBaseUrlPh: 'https://api.deepseek.com/v1',
    paLlmModelPh: 'deepseek-chat',
    paLlmApiKeyPh: 'sk-…',
    paLlmSave: '保存智能体配置',
    paLlmSaved: '已保存本机智能体配置',
  };
  const en = {
    paLlmSectionHint: 'Choose the call path in this section. Direct with my key is free. Direct is the default until you choose. The key stays on this device. See Alt+Shift+Z in the heading; the whole-page shortcut uses the same path. Click Settings to enter the API Key.',
    paLlmRouteLegend: 'Call path',
    paLlmRouteDirect: 'Direct with my key (free)',
    paLlmRouteSaas: 'Platform backend',
    paDirectNeedsConfig: 'Direct is selected. Enter the API Key, Base URL, and model in the popup, or switch to the platform backend.',
    paQuotaExhausted: 'Auto-innovate uses are exhausted. The platform backend deducts 1 use when a suggestion succeeds. You can switch the popup to a direct key instead.',
    paLlmSectionTitle: 'Auto-innovate agent',
    paLlmSettings: 'Settings',
    paLlmSettingsAria: 'Open Auto-innovate API key settings',
    paLlmBaseUrl: 'API Base URL',
    paLlmModel: 'Model',
    paLlmApiKey: 'API Key',
    paLlmBaseUrlPh: 'https://api.deepseek.com/v1',
    paLlmModelPh: 'deepseek-chat',
    paLlmApiKeyPh: 'sk-…',
    paLlmSave: 'Save agent settings',
    paLlmSaved: 'Local agent settings saved',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
