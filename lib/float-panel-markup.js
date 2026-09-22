'use strict';

/**
 * 页内浮窗 DOM 模板。从 content.js 抽出以遵守行数门禁，并承载「加入自动调度队列」勾选。
 * 品牌 SSOT：PLUGIN_DISPLAY_NAME → i18n floatBallTitle / extTitle（ADR-0089）。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
function floatPanelMarkupHtml() {
  const t = (key, params) => {
    try {
      if (typeof globalThis.tx === 'function') return globalThis.tx(key, params);
      if (globalThis.AidevpushI18n?.t) return globalThis.AidevpushI18n.t(key, params);
    } catch (_) { /* ignore */ }
    return key;
  };
  const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
  return `
    <button id="taskplugin-float-btn" title="${esc(t('floatBallTitle'))}">+</button>
    <div id="taskplugin-float-panel" role="dialog" aria-modal="true" aria-labelledby="taskplugin-float-title">
      <div class="taskplugin-panel-header">
        <h1 id="taskplugin-float-title" class="taskplugin-float-heading">${esc(t('floatQuickCreate'))}</h1>
        <div style="display:flex;align-items:center;gap:6px">
          <span id="taskplugin-login-badge" class="taskplugin-badge taskplugin-badge-err">${esc(t('floatNotLoggedIn'))}</span>
          <label class="taskplugin-locale-wrap">
            <span class="taskplugin-sr-only">${esc(t('pluginLocaleLabel'))}</span>
            <select id="taskplugin-float-locale" class="taskplugin-select taskplugin-locale-select" aria-label="${esc(t('pluginLocaleLabel'))}">
              <option value="zh-CN">${esc(t('pluginLocaleZh'))}</option>
              <option value="en">${esc(t('pluginLocaleEn'))}</option>
            </select>
          </label>
          <button id="taskplugin-float-close" type="button" class="taskplugin-float-close" aria-label="${esc(t('floatClosePanel'))}" title="${esc(t('floatClosePanel'))}">×</button>
        </div>
      </div>
      <div class="taskplugin-panel-body">
        <div class="taskplugin-captured-url" id="taskplugin-page-url"></div>
        <div id="taskplugin-aidev-status" class="taskplugin-aidev-status" hidden role="status" aria-live="polite"></div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-workspace">${esc(t('floatWorkspace'))}</label>
          <select class="taskplugin-select" id="taskplugin-workspace" aria-required="true" required>
            <option value="">${esc(t('floatPleaseLoginFirst'))}</option>
          </select>
        </div>
        <fieldset class="taskplugin-form-group taskplugin-fieldset">
          <legend>${esc(t('floatProjectLegend'))}</legend>
          <div class="taskplugin-checkbox-list" id="taskplugin-projects" role="radiogroup" aria-required="true" aria-label="${esc(t('panelProjectSingleAria'))}">
            <span style="color:#6c7086;font-size:11px;">${esc(t('floatPickWsFirst'))}</span>
          </div>
        </fieldset>
        <div class="taskplugin-form-group">
          <label for="taskplugin-title">${esc(t('floatTitle'))}</label>
          <input class="taskplugin-input" id="taskplugin-title" placeholder="${esc(t('floatTitlePlaceholder'))}" aria-required="true" required>
        </div>
        <div class="taskplugin-form-group">
          <div class="taskplugin-label-row">
            <label for="taskplugin-desc">${esc(t('floatDesc'))}</label>
            <span class="taskplugin-label-actions">
              <button type="button" class="taskplugin-btn taskplugin-btn-reset" id="taskplugin-desc-reset" title="${esc(t('floatDescResetTitle'))}" disabled>${esc(t('floatDescReset'))}</button>
            </span>
          </div>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" placeholder="${esc(t('floatDescPlaceholder'))}"></textarea>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-priority">${esc(t('floatPriority'))}</label>
          <select class="taskplugin-select" id="taskplugin-priority">
            <option value="0">${esc(t('panelPriorityHigh'))}</option>
            <option value="1" selected>${esc(t('panelPriorityMedium'))}</option>
            <option value="2">${esc(t('panelPriorityLow'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-progress">${esc(t('floatProgress'))}</label>
          <select class="taskplugin-select" id="taskplugin-progress">
            <option value="">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-deliverable">${esc(t('floatDeliverable'))}</label>
          <select class="taskplugin-select" id="taskplugin-deliverable">
            <option value="">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-image">${esc(t('panelInstalledImage'))} <span id="taskplugin-image-required" hidden style="color:#f38ba8;font-size:10px;">${esc(t('floatImageRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-image">
            <option value="">${esc(t('panelNone'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-feature-params">${esc(t('panelFeatureParams'))} <span style="color:#f38ba8;font-size:10px;">${esc(t('floatFeatureParamsRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-feature-params" aria-required="true">
            <option value="">${esc(t('panelSelectOption'))}</option>
            <option value="company">${esc(t('panelCompanyDefault'))}</option>
            <option value="workspace">${esc(t('panelWorkspaceDefault'))}</option>
            <option value="personal">${esc(t('panelPersonalConfig'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-personal-wrap" style="display:none">
          <label for="taskplugin-personal-config">${esc(t('panelPersonalConfig'))}</label>
          <select class="taskplugin-select" id="taskplugin-personal-config">
            <option value="">${esc(t('panelSelectPersonalConfig'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-due-date">${esc(t('floatDueDate'))}</label>
          <input class="taskplugin-input" type="datetime-local" id="taskplugin-due-date">
        </div>
        <div class="taskplugin-form-group">
          <label class="taskplugin-toggle-label" for="taskplugin-auto-run">
            <input type="checkbox" id="taskplugin-auto-run" disabled aria-disabled="true" aria-describedby="taskplugin-auto-run-hint">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">${esc(t('panelAutoRun'))}</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-auto-run-hint">${esc(t('panelPickProjectFirst'))}</span>
            </span>
          </label>
        </div>
        <div class="taskplugin-form-group taskplugin-queued-auto-run-wrap" id="taskplugin-queued-auto-run-wrap" hidden>
          <label class="taskplugin-toggle-label" for="taskplugin-queued-auto-run">
            <input type="checkbox" id="taskplugin-queued-auto-run" aria-describedby="taskplugin-queued-auto-run-hint">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title">${esc(t('panelQueuedAutoRun'))}</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-queued-auto-run-hint">${esc(t('panelQueuedAutoRunHint'))}</span>
            </span>
          </label>
          <div id="taskplugin-queued-auto-run-error" class="taskplugin-result" role="alert" hidden></div>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-git-identities"></div>
        <div class="taskplugin-form-group">
          <label>${esc(t('panelBaseBranch'))} <span style="color:#6c7086;font-size:10px;font-weight:normal;">${esc(t('floatBaseBranchShort'))}</span></label>
          <div id="taskplugin-repo-bases" class="taskplugin-checkbox-list">
            <span style="color:#6c7086;font-size:11px;">${esc(t('panelBaseBranchPlaceholder'))}</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-owner">${esc(t('panelOwner'))} <span style="color:#f38ba8;font-size:10px;">${esc(t('floatOwnerRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-owner" aria-required="true" required>
            <option value="">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label>${esc(t('floatCollaborators'))}</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-assignees">
            <span style="color:#6c7086;font-size:11px;">${esc(t('floatLoadMembersAfterWs'))}</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-work-branch">${esc(t('panelWorkBranch'))} <span style="color:#6c7086;font-size:10px;font-weight:normal;">${esc(t('floatWorkBranchHint'))}</span></label>
          <input class="taskplugin-input" id="taskplugin-work-branch" placeholder="${esc(t('floatWorkBranchPlaceholder'))}" list="taskplugin-work-branch-list">
          <datalist id="taskplugin-work-branch-list"></datalist>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-merge-target">${esc(t('panelMergeTarget'))} <span style="color:#6c7086;font-size:10px;font-weight:normal;">${esc(t('floatWorkBranchHint'))}</span></label>
          <input class="taskplugin-input" id="taskplugin-merge-target" placeholder="${esc(t('floatMergePlaceholder'))}" list="taskplugin-merge-list">
          <datalist id="taskplugin-merge-list"></datalist>
        </div>
        <button class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-submit">${esc(t('floatCreateTask'))}</button>
        <div id="taskplugin-result" class="taskplugin-result" role="status" aria-live="polite"></div>
      </div>
    </div>
    <div id="taskplugin-adjust-modal" class="taskplugin-modal" hidden>
      <div class="taskplugin-modal-card" role="dialog" aria-modal="true" aria-labelledby="taskplugin-adjust-title">
        <h4 id="taskplugin-adjust-title">${esc(t('floatAdjustTitle'))}</h4>
        <p class="taskplugin-modal-el" id="taskplugin-adjust-el-summary"></p>
        <label for="taskplugin-adjust-input">${esc(t('floatAdjustLabel'))}</label>
        <textarea id="taskplugin-adjust-input" class="taskplugin-textarea" rows="4" placeholder="${esc(t('floatAdjustPlaceholder'))}" aria-required="true"></textarea>
        <label class="taskplugin-shot-label" for="taskplugin-adjust-shot">
          <input type="checkbox" id="taskplugin-adjust-shot">
          <span>${esc(t('floatAdjustShot'))}</span>
        </label>
        <div class="taskplugin-modal-actions">
          <button type="button" class="taskplugin-btn" id="taskplugin-adjust-cancel">${esc(t('floatAdjustCancel'))}</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-adjust-confirm">${esc(t('floatAdjustConfirm'))}</button>
        </div>
        <div id="taskplugin-adjust-error" class="taskplugin-result" role="alert"></div>
      </div>
    </div>
`;
}

const FloatPanelMarkup = { html: floatPanelMarkupHtml };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FloatPanelMarkup;
}
if (typeof globalThis !== 'undefined') {
  globalThis.FloatPanelMarkup = FloatPanelMarkup;
}
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    floatPanelMarkupHtml,
  });
}
}
