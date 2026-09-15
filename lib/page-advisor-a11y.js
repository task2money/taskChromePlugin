/**
 * Alt+E 页面优化建议 — 可访问性文案与状态播报辅助（纯函数）。
 */

"use strict";

if (!globalThis.__taskpluginContentBoot?.skip) {
const PAGE_ADVISOR_A11Y = {
  toolbarLabel: "优化建议操作栏",
  safetyHint: "填入仅写入任务描述，不会自动创建任务",
  cancelLabel: "关闭预览并撤销改动",
  cancelTitle: "关闭建议面板，并还原本次预览已应用的所有改动",
  fillOneLabel: "逐条填入任务描述",
  fillOneTitle: "逐条把建议文案写入任务描述输入框，需手动提交",
  /** 与 appendSuggestionsToDescription 一致：追加，不覆盖 */
  fillAllLabel: "全部填入任务描述",
  fillAllTitle: "将全部建议追加写入任务描述输入框，保留已有内容",
  heading: "工作面板优化建议",
  documentTitle: "工作面板 · 优化建议 - 云端开发 SaaS 平台",
  loadingDefault: "正在采集页面并生成优化建议…",
  emptyStatus: "未返回可用建议",
  projectRadiogroupLabel: "项目（单选）",
};

/**
 * @param {number} count
 * @returns {string}
 */
function formatPageAdvisorReadyStatus(count) {
  const n = Number(count);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (safe <= 0) return PAGE_ADVISOR_A11Y.emptyStatus;
  return `已生成 ${safe} 条优化建议`;
}

/**
 * @param {(s: string) => string} esc
 * @returns {string}
 */
function buildPageAdvisorLayerHtml(esc) {
  const e = typeof esc === "function" ? esc : (s) => String(s ?? "");
  return `
    <h1 id="taskplugin-page-advisor-heading" class="sr-only">${e(PAGE_ADVISOR_A11Y.heading)}</h1>
    <div id="taskplugin-page-advisor-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="taskplugin-page-advisor-cards" class="taskplugin-page-advisor-cards"></div>
    <div id="taskplugin-page-advisor-toolbar" class="taskplugin-page-advisor-toolbar" role="toolbar" aria-label="${e(PAGE_ADVISOR_A11Y.toolbarLabel)}" aria-describedby="taskplugin-page-advisor-hint">
      <p class="taskplugin-page-advisor-toolbar-hint taskplugin-page-advisor-safety-hint" id="taskplugin-page-advisor-hint">${e(PAGE_ADVISOR_A11Y.safetyHint)}</p>
      <div class="taskplugin-page-advisor-toolbar-actions">
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-cancel" title="${e(PAGE_ADVISOR_A11Y.cancelTitle)}">${e(PAGE_ADVISOR_A11Y.cancelLabel)}</button>
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-retry" hidden>重试</button>
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-fill-one" disabled aria-busy="false" title="${e(PAGE_ADVISOR_A11Y.fillOneTitle)}">${e(PAGE_ADVISOR_A11Y.fillOneLabel)}</button>
        <button type="button" class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-page-advisor-fill-all" disabled aria-busy="false" title="${e(PAGE_ADVISOR_A11Y.fillAllTitle)}">${e(PAGE_ADVISOR_A11Y.fillAllLabel)}</button>
      </div>
      <div id="taskplugin-page-advisor-links" class="taskplugin-page-advisor-links" hidden></div>
      <div id="taskplugin-page-advisor-error" class="taskplugin-result"></div>
    </div>
  `;
}

const PageAdvisorA11y = {
  ...PAGE_ADVISOR_A11Y,
  formatReadyStatus: formatPageAdvisorReadyStatus,
  buildLayerHtml: buildPageAdvisorLayerHtml,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = PageAdvisorA11y;
}
if (typeof globalThis !== "undefined") {
  globalThis.PageAdvisorA11y = PageAdvisorA11y;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    PAGE_ADVISOR_A11Y, formatPageAdvisorReadyStatus,
    buildPageAdvisorLayerHtml,
  });
}
}
