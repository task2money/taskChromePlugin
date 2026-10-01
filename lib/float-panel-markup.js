'use strict';

/**
 * 页内浮窗 DOM 模板。从 content.js 抽出以遵守行数门禁，并承载「加入自动调度队列」勾选。
 * 品牌 SSOT：PLUGIN_DISPLAY_NAME → i18n floatBallTitle / extTitle（ADR-0089）。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
function floatPanelMarkupHtml(mode) {
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
  const full = `
    <button id="taskplugin-float-btn" data-i18n-title="floatBallTitle" title="${esc(t('floatBallTitle'))}">+</button>
    <!--sp:panel-->
    <div id="taskplugin-float-panel" role="dialog" aria-modal="true" aria-labelledby="taskplugin-float-title">
      <div class="taskplugin-panel-header">
        <h1 id="taskplugin-float-title" class="taskplugin-float-heading" data-i18n="floatQuickCreate">${esc(t('floatQuickCreate'))}</h1>
        <div style="display:flex;align-items:center;gap:6px">
          <button type="button" id="taskplugin-login-badge" class="taskplugin-badge taskplugin-badge-err">${esc(t('floatNotLoggedIn'))}</button>
          <label class="taskplugin-locale-wrap">
            <span class="taskplugin-sr-only" data-i18n="pluginLocaleLabel">${esc(t('pluginLocaleLabel'))}</span>
            <select id="taskplugin-float-locale" class="taskplugin-select taskplugin-locale-select" data-i18n-aria-label="pluginLocaleLabel" aria-label="${esc(t('pluginLocaleLabel'))}">
              <option value="zh-CN" data-i18n="pluginLocaleZh">${esc(t('pluginLocaleZh'))}</option>
              <option value="en" data-i18n="pluginLocaleEn">${esc(t('pluginLocaleEn'))}</option>
            </select>
          </label>
          <button id="taskplugin-float-close" type="button" class="taskplugin-float-close" data-i18n-aria-label="floatClosePanel" data-i18n-title="floatClosePanel" aria-label="${esc(t('floatClosePanel'))}" title="${esc(t('floatClosePanel'))}">×</button>
        </div>
      </div>
      <div id="taskplugin-toolbar-pin-hint" class="taskplugin-toolbar-pin-hint" hidden>
        <p data-i18n="toolbarPinPageHint">${esc(t('toolbarPinPageHint'))}</p>
        <button type="button" id="taskplugin-toolbar-pin-hint-close" data-i18n="toolbarPinPageHintClose">${esc(t('toolbarPinPageHintClose'))}</button>
      </div>
      <div class="taskplugin-panel-body">
        <div class="taskplugin-captured-url" id="taskplugin-page-url"></div>
        <div id="taskplugin-aidev-status" class="taskplugin-aidev-status" hidden role="status" aria-live="polite"></div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-workspace" data-i18n="floatWorkspace">${esc(t('floatWorkspace'))}</label>
          <select class="taskplugin-select" id="taskplugin-workspace" aria-required="true" required>
            <option value="" data-i18n="floatPleaseLoginFirst">${esc(t('floatPleaseLoginFirst'))}</option>
          </select>
        </div>
        <fieldset class="taskplugin-form-group taskplugin-fieldset">
          <legend data-i18n="floatProjectLegend">${esc(t('floatProjectLegend'))}</legend>
          <div class="taskplugin-checkbox-list" id="taskplugin-projects" role="radiogroup" aria-required="true" data-i18n-aria-label="panelProjectSingleAria" aria-label="${esc(t('panelProjectSingleAria'))}">
            <span style="color:#6c7086;font-size:11px;" data-i18n="floatPickWsFirst">${esc(t('floatPickWsFirst'))}</span>
          </div>
        </fieldset>
        <div class="taskplugin-form-group">
          <label for="taskplugin-title" data-i18n="floatTitle">${esc(t('floatTitle'))}</label>
          <input class="taskplugin-input" id="taskplugin-title" data-i18n-placeholder="floatTitlePlaceholder" placeholder="${esc(t('floatTitlePlaceholder'))}" aria-required="true" required>
        </div>
        <div class="taskplugin-form-group">
          <div class="taskplugin-label-row">
            <label for="taskplugin-desc" data-i18n="floatDesc">${esc(t('floatDesc'))}</label>
            <span class="taskplugin-label-actions">
              <button type="button" class="taskplugin-btn taskplugin-btn-reset" id="taskplugin-desc-reset" data-i18n="floatDescReset" data-i18n-title="floatDescResetTitle" title="${esc(t('floatDescResetTitle'))}" disabled>${esc(t('floatDescReset'))}</button>
            </span>
          </div>
          <textarea class="taskplugin-textarea" id="taskplugin-desc" data-i18n-placeholder="floatDescPlaceholder" placeholder="${esc(t('floatDescPlaceholder'))}"></textarea>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-priority" data-i18n="floatPriority">${esc(t('floatPriority'))}</label>
          <select class="taskplugin-select" id="taskplugin-priority">
            <option value="0" data-i18n="panelPriorityHigh">${esc(t('panelPriorityHigh'))}</option>
            <option value="1" selected data-i18n="panelPriorityMedium">${esc(t('panelPriorityMedium'))}</option>
            <option value="2" data-i18n="panelPriorityLow">${esc(t('panelPriorityLow'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-progress" data-i18n="floatProgress">${esc(t('floatProgress'))}</label>
          <select class="taskplugin-select" id="taskplugin-progress">
            <option value="" data-i18n="commonPickWsFirstOption">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-deliverable" data-i18n="floatDeliverable">${esc(t('floatDeliverable'))}</label>
          <select class="taskplugin-select" id="taskplugin-deliverable">
            <option value="" data-i18n="commonPickWsFirstOption">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-image"><span data-i18n="panelInstalledImage">${esc(t('panelInstalledImage'))}</span> <span id="taskplugin-image-required" hidden style="color:#f38ba8;font-size:10px;">${esc(t('floatImageRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-image">
            <option value="" data-i18n="panelNone">${esc(t('panelNone'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-feature-params"><span data-i18n="panelFeatureParams">${esc(t('panelFeatureParams'))}</span> <span style="color:#f38ba8;font-size:10px;" data-i18n="floatFeatureParamsRequired">${esc(t('floatFeatureParamsRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-feature-params" aria-required="true">
            <option value="" data-i18n="panelSelectOption">${esc(t('panelSelectOption'))}</option>
            <option value="company" data-i18n="panelCompanyDefault">${esc(t('panelCompanyDefault'))}</option>
            <option value="workspace" data-i18n="panelWorkspaceDefault">${esc(t('panelWorkspaceDefault'))}</option>
            <option value="personal" data-i18n="panelPersonalConfig">${esc(t('panelPersonalConfig'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-personal-wrap" style="display:none">
          <label for="taskplugin-personal-config" data-i18n="panelPersonalConfig">${esc(t('panelPersonalConfig'))}</label>
          <select class="taskplugin-select" id="taskplugin-personal-config">
            <option value="" data-i18n="panelSelectPersonalConfig">${esc(t('panelSelectPersonalConfig'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-due-date" data-i18n="floatDueDate">${esc(t('floatDueDate'))}</label>
          <input class="taskplugin-input" type="datetime-local" id="taskplugin-due-date">
        </div>
        <div class="taskplugin-form-group">
          <label class="taskplugin-toggle-label" for="taskplugin-auto-run">
            <input type="checkbox" id="taskplugin-auto-run" disabled aria-disabled="true" aria-describedby="taskplugin-auto-run-hint">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title" data-i18n="panelAutoRun">${esc(t('panelAutoRun'))}</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-auto-run-hint">${esc(t('panelPickProjectFirst'))}</span>
            </span>
          </label>
        </div>
        <div class="taskplugin-form-group taskplugin-queued-auto-run-wrap" id="taskplugin-queued-auto-run-wrap" hidden>
          <label class="taskplugin-toggle-label" for="taskplugin-queued-auto-run">
            <input type="checkbox" id="taskplugin-queued-auto-run" aria-describedby="taskplugin-queued-auto-run-hint">
            <span class="taskplugin-toggle-text">
              <span class="taskplugin-toggle-title" data-i18n="panelQueuedAutoRun">${esc(t('panelQueuedAutoRun'))}</span>
              <span class="taskplugin-toggle-hint" id="taskplugin-queued-auto-run-hint" data-i18n="panelQueuedAutoRunHint">${esc(t('panelQueuedAutoRunHint'))}</span>
            </span>
          </label>
          <div id="taskplugin-queued-auto-run-error" class="taskplugin-result" role="alert" hidden></div>
        </div>
        <div class="taskplugin-form-group" id="taskplugin-git-identities"></div>
        <div class="taskplugin-form-group">
          <label><span data-i18n="panelBaseBranch">${esc(t('panelBaseBranch'))}</span> <span style="color:#6c7086;font-size:10px;font-weight:normal;" data-i18n="floatBaseBranchShort">${esc(t('floatBaseBranchShort'))}</span></label>
          <div id="taskplugin-repo-bases" class="taskplugin-checkbox-list">
            <span style="color:#6c7086;font-size:11px;" data-i18n="panelBaseBranchPlaceholder">${esc(t('panelBaseBranchPlaceholder'))}</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-owner"><span data-i18n="panelOwner">${esc(t('panelOwner'))}</span> <span style="color:#f38ba8;font-size:10px;" data-i18n="floatOwnerRequired">${esc(t('floatOwnerRequired'))}</span></label>
          <select class="taskplugin-select" id="taskplugin-owner" aria-required="true" required>
            <option value="" data-i18n="commonPickWsFirstOption">${esc(t('commonPickWsFirstOption'))}</option>
          </select>
        </div>
        <div class="taskplugin-form-group">
          <label data-i18n="floatCollaborators">${esc(t('floatCollaborators'))}</label>
          <div class="taskplugin-checkbox-list" id="taskplugin-assignees">
            <span style="color:#6c7086;font-size:11px;" data-i18n="floatLoadMembersAfterWs">${esc(t('floatLoadMembersAfterWs'))}</span>
          </div>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-work-branch"><span data-i18n="panelWorkBranch">${esc(t('panelWorkBranch'))}</span> <span style="color:#6c7086;font-size:10px;font-weight:normal;" data-i18n="floatWorkBranchHint">${esc(t('floatWorkBranchHint'))}</span></label>
          <input class="taskplugin-input" id="taskplugin-work-branch" data-i18n-placeholder="floatWorkBranchPlaceholder" placeholder="${esc(t('floatWorkBranchPlaceholder'))}" list="taskplugin-work-branch-list">
          <datalist id="taskplugin-work-branch-list"></datalist>
        </div>
        <div class="taskplugin-form-group">
          <label for="taskplugin-merge-target"><span data-i18n="panelMergeTarget">${esc(t('panelMergeTarget'))}</span> <span style="color:#6c7086;font-size:10px;font-weight:normal;" data-i18n="floatWorkBranchHint">${esc(t('floatWorkBranchHint'))}</span></label>
          <input class="taskplugin-input" id="taskplugin-merge-target" data-i18n-placeholder="floatMergePlaceholder" placeholder="${esc(t('floatMergePlaceholder'))}" list="taskplugin-merge-list">
          <datalist id="taskplugin-merge-list"></datalist>
        </div>
        <button class="taskplugin-btn taskplugin-btn-primary" id="taskplugin-submit" data-i18n="floatCreateTask">${esc(t('floatCreateTask'))}</button>
        <div id="taskplugin-result" class="taskplugin-result" role="status" aria-live="polite"></div>
      </div>
    </div>
    <!--sp:modal-->
    <div id="taskplugin-adjust-modal" class="taskplugin-modal" hidden>
      <div class="taskplugin-modal-card" role="dialog" aria-modal="true" aria-labelledby="taskplugin-adjust-title">
        <h4 id="taskplugin-adjust-title" data-i18n="floatAdjustTitle">${esc(t('floatAdjustTitle'))}</h4>
        <p class="taskplugin-modal-el" id="taskplugin-adjust-el-summary"></p>
        <label for="taskplugin-adjust-input" data-i18n="floatAdjustLabel">${esc(t('floatAdjustLabel'))}</label>
        <textarea id="taskplugin-adjust-input" class="taskplugin-textarea" rows="4" data-i18n-placeholder="floatAdjustPlaceholder" placeholder="${esc(t('floatAdjustPlaceholder'))}" aria-required="true"></textarea>
        <label class="taskplugin-shot-label" for="taskplugin-adjust-shot">
          <input type="checkbox" id="taskplugin-adjust-shot">
          <span data-i18n="floatAdjustShot">${esc(t('floatAdjustShot'))}</span>
        </label>
        <div class="taskplugin-modal-actions">
          <button type="button" class="taskplugin-btn" id="taskplugin-adjust-cancel" data-i18n="floatAdjustCancel">${esc(t('floatAdjustCancel'))}</button>
          <button type="button" class="taskplugin-btn taskplugin-btn-primary taskplugin-btn-modal-primary" id="taskplugin-adjust-confirm" data-i18n="floatAdjustConfirm">${esc(t('floatAdjustConfirm'))}</button>
        </div>
        <div id="taskplugin-adjust-error" class="taskplugin-result" role="alert"></div>
      </div>
    </div>
`;
  const panelAt = full.indexOf('<!--sp:panel-->');
  const modalAt = full.indexOf('<!--sp:modal-->');
  if (mode === 'page') return full.slice(0, panelAt) + full.slice(modalAt);
  if (mode === 'form') return full.slice(panelAt + '<!--sp:panel-->'.length, modalAt);
  return full;
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
