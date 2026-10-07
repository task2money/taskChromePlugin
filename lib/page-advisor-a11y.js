/**
 * Alt+E 页面优化建议 — 可访问性文案与状态播报辅助（纯函数）。
 */

"use strict";

if (!globalThis.__taskpluginContentBoot?.skip) {
const PA_ZH = {
  paToolbarLabel: "优化建议操作栏",
  paSafetyHint: "填入仅写入任务描述，不会自动创建任务",
  paToolbarDragHandle: "拖动建议底栏，双击复位",
  paToolbarDragTitle: "拖动移动底栏；双击把手复位",
  paToolbarNightTitle: "设置夜间任务调度，享用低价机器及智能体资源",
  paCancelLabel: "关闭预览并撤销改动",
  paCancelTitle: "关闭建议面板，并还原本次预览已应用的所有改动",
  paFillOne: "拷贝并逐条填入",
  paFillOneTitle: "拷贝当前第一条已勾选建议到剪切板，并追加写入任务描述。正文含元素/选择器/可见文本/HTML 片段与调整期望。",
  paFillOneHelp: "拷贝当前第一条已勾选建议到剪切板，并追加写入任务描述。正文含元素/选择器/可见文本/HTML 片段与调整期望。",
  paFillAll: "拷贝并全部填入",
  paFillAllTitle: "拷贝全部已勾选建议到剪切板，并追加写入任务描述。含元素/选择器/可见文本/HTML 片段与调整期望；锚点相对于生成建议时的页面，请一次性应用。",
  paFillAllHelp: "拷贝全部已勾选建议到剪切板，并追加写入任务描述。含元素/选择器/可见文本/HTML 片段与调整期望；锚点相对于生成建议时的页面，请一次性应用。",
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
  get fillOneHelp() { return paTx("paFillOneHelp"); },
  get fillAllLabel() { return paTx("paFillAll"); },
  get fillAllTitle() { return paTx("paFillAllTitle"); },
  get fillAllHelp() { return paTx("paFillAllHelp"); },
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
function paFillBang(e, help) {
  // Anti-Replay-OK: 「!」只展示说明，不写剪贴板、不改描述。
  const text = e(help);
  return `<span class="taskplugin-page-advisor-bang" tabindex="0" role="note" aria-label="${text}">!<span class="taskplugin-page-advisor-bang-tip" role="tooltip">${text}</span></span>`;
}

function buildPageAdvisorLayerHtml(esc) {
  const e = typeof esc === "function" ? esc : (s) => String(s ?? "");
  return `
    <h1 id="taskplugin-page-advisor-heading" class="sr-only">${e(PAGE_ADVISOR_A11Y.heading)}</h1>
    <div id="taskplugin-page-advisor-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="taskplugin-page-advisor-cards" class="taskplugin-page-advisor-cards"></div>
    <div id="taskplugin-page-advisor-toolbar" class="taskplugin-page-advisor-toolbar" role="toolbar" aria-label="${e(PAGE_ADVISOR_A11Y.toolbarLabel)}" data-i18n-aria-label="paToolbarLabel">
      <div class="taskplugin-page-advisor-toolbar-drag" role="button" tabindex="0"
        aria-label="${e(paTx("paToolbarDragHandle"))}" data-i18n-aria-label="paToolbarDragHandle"
        title="${e(paTx("paToolbarDragTitle"))}" data-i18n-title="paToolbarDragTitle"><span class="taskplugin-page-advisor-toolbar-drag-mark" aria-hidden="true">⋮⋮</span><span class="taskplugin-page-advisor-toolbar-title" data-i18n="paToolbarNightTitle">${e(paTx("paToolbarNightTitle"))}</span></div>
      <div class="taskplugin-page-advisor-toolbar-actions">
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-cancel" title="${e(PAGE_ADVISOR_A11Y.cancelTitle)}" data-i18n-title="paCancelTitle" data-i18n="paCancelLabel">${e(PAGE_ADVISOR_A11Y.cancelLabel)}</button>
        <button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-retry" hidden data-i18n="paRetry">${e(paTx("paRetry"))}</button>
        <span class="taskplugin-page-advisor-fill-pair"><button type="button" class="taskplugin-btn" id="taskplugin-page-advisor-fill-one" disabled aria-busy="false" title="${e(PAGE_ADVISOR_A11Y.fillOneTitle)}" data-i18n-title="paFillOneTitle" data-i18n="paFillOne">${e(PAGE_ADVISOR_A11Y.fillOneLabel)}</button>${paFillBang(e, PAGE_ADVISOR_A11Y.fillOneHelp)}</span>
        <span class="taskplugin-page-advisor-fill-pair"><button type="button" class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-page-advisor-fill-all" disabled aria-busy="false" title="${e(PAGE_ADVISOR_A11Y.fillAllTitle)}" data-i18n-title="paFillAllTitle" data-i18n="paFillAll">${e(PAGE_ADVISOR_A11Y.fillAllLabel)}</button>${paFillBang(e, PAGE_ADVISOR_A11Y.fillAllHelp)}</span>
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
  if (globalThis.AidevpushI18n && typeof globalThis.AidevpushI18n.registerMessages === "function") {
    globalThis.AidevpushI18n.registerMessages({
      "zh-CN": {
        paToolbarDragHandle: "拖动建议底栏，双击复位",
        paToolbarDragTitle: "拖动移动底栏；双击把手复位",
        paToolbarNightTitle: "设置夜间任务调度，享用低价机器及智能体资源",
        paFillOne: "拷贝并逐条填入",
        paFillOneTitle: "拷贝当前第一条已勾选建议到剪切板，并追加写入任务描述。正文含元素/选择器/可见文本/HTML 片段与调整期望。",
        paFillOneHelp: "拷贝当前第一条已勾选建议到剪切板，并追加写入任务描述。正文含元素/选择器/可见文本/HTML 片段与调整期望。",
        paFillAll: "拷贝并全部填入",
        paFillAllTitle: "拷贝全部已勾选建议到剪切板，并追加写入任务描述。含元素/选择器/可见文本/HTML 片段与调整期望；锚点相对于生成建议时的页面，请一次性应用。",
        paFillAllHelp: "拷贝全部已勾选建议到剪切板，并追加写入任务描述。含元素/选择器/可见文本/HTML 片段与调整期望；锚点相对于生成建议时的页面，请一次性应用。",
      },
      en: {
        paToolbarDragHandle: "Drag the suggestion bar; double-click to reset",
        paToolbarDragTitle: "Drag to move the bar; double-click the handle to reset",
        paToolbarNightTitle: "Schedule tasks overnight for lower-priced machines and agent resources",
        paFillOne: "Copy and fill one",
        paFillOneTitle: "Copy the first checked suggestion to the clipboard and append it to the task description. Includes element, selector, visible text, HTML snippet, and adjustment expectation.",
        paFillOneHelp: "Copy the first checked suggestion to the clipboard and append it to the task description. Includes element, selector, visible text, HTML snippet, and adjustment expectation.",
        paFillAll: "Copy and fill all",
        paFillAllTitle: "Copy every checked suggestion to the clipboard and append them to the task description. Includes element, selector, visible text, HTML snippet, and adjustment expectation. Anchors refer to the page at capture time; apply them in one pass.",
        paFillAllHelp: "Copy every checked suggestion to the clipboard and append them to the task description. Includes element, selector, visible text, HTML snippet, and adjustment expectation. Anchors refer to the page at capture time; apply them in one pass.",
      },
    });
  }
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    PAGE_ADVISOR_A11Y, formatPageAdvisorReadyStatus,
    buildPageAdvisorLayerHtml,
  });
}
}
