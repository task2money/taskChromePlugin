/**
 * Alt+E 页面优化建议 — 可访问性文案与状态播报辅助（纯函数）。
 */

"use strict";

if (!globalThis.__taskpluginContentBoot?.skip) {
const PA_ZH = {
  paToolbarLabel: "优化建议操作栏",
  paSafetyHint: "填入仅写入任务描述，不会自动创建任务",
  paCancelLabel: "关闭预览并撤销改动",
  paCancelTitle: "关闭建议面板，并还原本次预览已应用的所有改动",
  paFillOne: "逐条填入任务描述",
  paFillOneTitle: "逐条把建议文案写入任务描述输入框，需手动提交",
  paFillAll: "全部填入任务描述",
  paFillAllTitle: "将全部建议追加写入任务描述输入框，保留已有内容",
  paHeading: "工作面板优化建议",
  paDocumentTitle: "工作面板 · 优化建议 - 云端开发 SaaS 平台",
  paLoading: "正在采集页面并生成优化建议…",
  paEmpty: "未返回可用建议",
  paReadyCount: "已生成 {count} 条优化建议",
  paRetry: "重试",
  panelProjectSingleAria: "项目（单选）",
};

function paTx(key, params) {
  try {
    if (typeof globalThis.tx === "function") {
      const out = globalThis.tx(key, params);
      if (out != null && out !== key) return out;
    }
    if (globalThis.AidevpushI18n?.t) {
      const out = globalThis.AidevpushI18n.t(key, params);
      if (out != null && out !== key) return out;
    }
  } catch (_) { /* ignore */ }
  let fb = PA_ZH[key] || key;
  if (params && typeof params === "object") {
    fb = String(fb).replace(/\{(\w+)\}/g, (_, k) =>
      params[k] != null ? String(params[k]) : `{${k}}`,
    );
  }
  return fb;
}

const PAGE_ADVISOR_A11Y = {
  get toolbarLabel() { return paTx("paToolbarLabel"); },
  get safetyHint() { return paTx("paSafetyHint"); },
  get cancelLabel() { return paTx("paCancelLabel"); },
  get cancelTitle() { return paTx("paCancelTitle"); },
  get fillOneLabel() { return paTx("paFillOne"); },
  get fillOneTitle() { return paTx("paFillOneTitle"); },
  get fillAllLabel() { return paTx("paFillAll"); },
  get fillAllTitle() { return paTx("paFillAllTitle"); },
  get heading() { return paTx("paHeading"); },
  get documentTitle() { return paTx("paDocumentTitle"); },
  get loadingDefault() { return paTx("paLoading"); },
  get emptyStatus() { return paTx("paEmpty"); },
  get projectRadiogroupLabel() { return paTx("panelProjectSingleAria"); },
};

/**
 * @param {number} count
 * @returns {string}
 */
function formatPageAdvisorReadyStatus(count) {
  const n = Number(count);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (safe <= 0) return paTx("paEmpty");
  return paTx("paReadyCount", { count: safe });
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
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-retry" hidden>${e(paTx("paRetry"))}</button>
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
