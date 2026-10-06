/**
 * Alt+Z 建议送达目标（任务描述 / Cursor / Claude / Codex / Trae / WorkBuddy）。
 * 纯函数；content 词法名不得与其它 content_scripts 顶层 const/let 冲突。
 */
if (!globalThis.__taskpluginContentBoot?.skip) {
(function initPageAdvisorDelivery(global) {
  'use strict';

  var PAGE_ADVISOR_DELIVERY_TARGETS = [
    'task_description',
    'cursor',
    'claude',
    'codex',
    'trae',
    'workbuddy',
  ];

  function normalizeTarget(raw) {
    var v = String(raw || '').trim();
    return PAGE_ADVISOR_DELIVERY_TARGETS.indexOf(v) >= 0 ? v : 'task_description';
  }

  function shouldAutoDeliverOnResult(target) {
    return normalizeTarget(target) !== 'task_description';
  }

  function shouldOpenCreatePanel(target) {
    return normalizeTarget(target) === 'task_description';
  }

  var IDE_I18N = {
    cursor: 'paDeliveryCursor',
    claude: 'paDeliveryClaude',
    codex: 'paDeliveryCodex',
    trae: 'paDeliveryTrae',
    workbuddy: 'paDeliveryWorkBuddy',
  };
  var IDE_FALLBACK = {
    cursor: 'Cursor',
    claude: 'Claude',
    codex: 'Codex',
    trae: 'Trae',
    workbuddy: 'WorkBuddy',
  };

  function ideDisplayName(target, tx) {
    var t = normalizeTarget(target);
    if (typeof tx === 'function') {
      return tx(IDE_I18N[t] || 'paDeliveryTaskDesc');
    }
    return IDE_FALLBACK[t] || '任务描述';
  }

  function formatUserStatus(target, outcome, tx) {
    var t = typeof tx === 'function' ? tx : function (k) { return k; };
    var name = ideDisplayName(target, tx);
    var nativeOk = !!(outcome && outcome.nativeOk);
    var clipboardOk = !!(outcome && outcome.clipboardOk);
    var nativeError = String((outcome && outcome.nativeError) || '');
    if (nativeOk) {
      return { ok: true, text: t('paDeliverNativeOk', { name: name }) };
    }
    if (nativeError === 'app_not_running' && clipboardOk) {
      return { ok: true, text: t('paDeliverAppNotRunning', { name: name }) };
    }
    if (clipboardOk) {
      return { ok: true, text: t('paDeliverClipboardOnly', { name: name }) };
    }
    return { ok: false, text: t('paDeliverClipboardFail') };
  }

  var PageAdvisorDelivery = {
    TARGETS: PAGE_ADVISOR_DELIVERY_TARGETS,
    STORAGE_KEY: 'pageAdvisorDeliveryTarget',
    NATIVE_HOST: 'com.aidevpush.ide_bridge',
    normalizeTarget: normalizeTarget,
    shouldAutoDeliverOnResult: shouldAutoDeliverOnResult,
    shouldOpenCreatePanel: shouldOpenCreatePanel,
    ideDisplayName: ideDisplayName,
    formatUserStatus: formatUserStatus,
  };

  global.PageAdvisorDelivery = PageAdvisorDelivery;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PageAdvisorDelivery;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
}
