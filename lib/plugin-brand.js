/**
 * 用户可见插件品牌名（Chrome 扩展商店 / 工具栏 / 弹窗 / DevTools 标签）
 * 内部模块名、日志前缀、目录名仍用 taskChromePlugin。
 */

const PLUGIN_DISPLAY_NAME = '云端Coding: 自动创新助手';

const PluginBrand = { PLUGIN_DISPLAY_NAME };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PluginBrand;
}
if (typeof globalThis !== 'undefined') {
  globalThis.PluginBrand = PluginBrand;
  globalThis.PLUGIN_DISPLAY_NAME = PLUGIN_DISPLAY_NAME;
}
