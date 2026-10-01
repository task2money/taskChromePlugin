/**
 * 设置页「固定到工具栏」文案。扩展不能代用户打开这项。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    toolbarPinLabel: '固定到工具栏',
    toolbarPinOn: '已打开',
    toolbarPinOff: '未打开',
    toolbarPinUnknown: '读取中…',
    toolbarPinHint: 'Chrome 不允许扩展自己打开「固定到工具栏」。请点地址栏右侧的拼图图标，找到本扩展，打开「固定到工具栏」。打开后这里会显示「已打开」。',
    toolbarPinPageHint: '扩展图标还没固定到工具栏。点地址栏右侧的拼图图标，找到本扩展，打开「固定到工具栏」。',
    toolbarPinPageHintClose: '知道了',
  };
  const en = {
    toolbarPinLabel: 'Pin to toolbar',
    toolbarPinOn: 'On',
    toolbarPinOff: 'Off',
    toolbarPinUnknown: 'Checking…',
    toolbarPinHint: 'Chrome does not let an extension turn on Pin to toolbar. Click the puzzle icon beside the address bar, find this extension, and turn that on. This row then shows On.',
    toolbarPinPageHint: 'This extension is not pinned to the toolbar. Click the puzzle icon beside the address bar, find this extension, and turn on Pin to toolbar.',
    toolbarPinPageHintClose: 'Got it',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en: en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh: zh, en: en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
