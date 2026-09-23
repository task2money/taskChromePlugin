/**
 * 创建任务自动运行时的硬件库存提示。独立文件，避免撑大 i18n-messages.js。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function (global) {
  const zh = {
    hardwareStockOut: '项目「{name}」的运行硬件 {instanceType}（{where}）暂无库存，请到项目详情页更换硬件后再创建自动运行任务。',
    hardwareStockQueryFailed: '查询硬件库存失败，请稍后重试',
  };
  const en = {
    hardwareStockOut: 'Project "{name}" run hardware {instanceType} ({where}) is out of stock. Change the hardware on the project details page, then create the auto-run task again.',
    hardwareStockQueryFailed: 'Could not check hardware stock. Try again later.',
  };
  if (global.AidevpushI18n) {
    global.AidevpushI18n.registerMessages({ 'zh-CN': zh, en });
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { zh, en };
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
